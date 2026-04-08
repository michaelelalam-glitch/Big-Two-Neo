#!/usr/bin/env node
/**
 * ci-seed-e2e-auth.mjs
 *
 * Seeds a Supabase email/password session into the app's AsyncStorage SQLite
 * on the iOS Simulator or Android Emulator before running authenticated E2E flows.
 *
 * How it works:
 *   1. Signs in via Supabase password REST endpoint using E2E test credentials.
 *   2. Writes the session JSON to the app's AsyncStorage database under the
 *      Supabase storage key (sb-<project-ref>-auth-token).
 *   3. expo-secure-store's getItem() always checks SecureStore first. Because the
 *      key was never written there (this is a fresh CI run), SecureStore returns null
 *      and the adapter falls through to AsyncStorage where it finds our injected
 *      session, authenticating the app without any OAuth browser flow.
 *
 * Required env vars:
 *   EXPO_PUBLIC_SUPABASE_URL       e.g. https://abc.supabase.co
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY  anon key
 *   E2E_TEST_EMAIL                 test account email (email/password auth)
 *   E2E_TEST_PASSWORD              test account password
 *   CI_PLATFORM                    'ios' or 'android' (default: ios)
 *
 * Usage:
 *   CI_PLATFORM=android node apps/mobile/scripts/ci-seed-e2e-auth.mjs
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const testEmail = process.env.E2E_TEST_EMAIL;
const testPassword = process.env.E2E_TEST_PASSWORD;
const platform = (process.env.CI_PLATFORM || 'ios').toLowerCase();

// ─── Validate env ────────────────────────────────────────────────────────────
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('[ci-seed-auth] ❌ Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}
if (!testEmail || !testPassword) {
  console.error('[ci-seed-auth] ❌ Missing E2E_TEST_EMAIL or E2E_TEST_PASSWORD');
  process.exit(1);
}
if (!['ios', 'android'].includes(platform)) {
  console.error(`[ci-seed-auth] ❌ CI_PLATFORM must be 'ios' or 'android', got: ${platform}`);
  process.exit(1);
}

const APP_ID = 'com.big2mobile.app';
// Supabase JS v2 storage key: sb-{hostname}-auth-token
const hostname = new URL(supabaseUrl).hostname;
const STORAGE_KEY = `sb-${hostname}-auth-token`;

console.log(`[ci-seed-auth] Platform: ${platform}`);
console.log(`[ci-seed-auth] Supabase URL: ${supabaseUrl}`);
console.log(`[ci-seed-auth] Storage key: ${STORAGE_KEY}`);
console.log(`[ci-seed-auth] Test user: ${testEmail}`);

// ─── Step 1: Obtain session via Supabase REST ─────────────────────────────────
console.log('[ci-seed-auth] Signing in via Supabase password grant...');
const authEndpoint = `${supabaseUrl}/auth/v1/token?grant_type=password`;

let session;
try {
  const res = await fetch(authEndpoint, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: testEmail, password: testPassword }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[ci-seed-auth] ❌ Auth failed (HTTP ${res.status}): ${body}`);
    process.exit(1);
  }

  session = await res.json();
} catch (err) {
  console.error(`[ci-seed-auth] ❌ Network error during auth: ${err.message}`);
  process.exit(1);
}

if (!session.access_token || !session.refresh_token) {
  console.error('[ci-seed-auth] ❌ Session response missing access_token or refresh_token');
  console.error(JSON.stringify(session, null, 2));
  process.exit(1);
}

const sessionJson = JSON.stringify(session);
console.log(`[ci-seed-auth] ✅ Session obtained (${sessionJson.length} bytes, expires_at=${session.expires_at})`);

// ─── Step 2: Inject into the appropriate storage ──────────────────────────────
if (platform === 'android') {
  injectAndroid(STORAGE_KEY, sessionJson);
} else {
  injectIOS(STORAGE_KEY, sessionJson);
}

// ─── Android injection via adb + sqlite3 ─────────────────────────────────────
function injectAndroid(key, value) {
  const DB_PATH = `/data/data/${APP_ID}/databases/RKStorage`;

  // Write a temporary SQL file locally, push it to the device, execute it.
  // This avoids shell-escaping nightmares for the large JSON value.
  const tmpSql = join(tmpdir(), 'e2e_auth_inject.sql');
  const escapedValue = value.replace(/'/g, "''");
  const sql =
    `CREATE TABLE IF NOT EXISTS catalystLocalStorage ` +
    `(key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');\n` +
    `INSERT OR REPLACE INTO catalystLocalStorage (key, value) ` +
    `VALUES ('${key}', '${escapedValue}');`;

  writeFileSync(tmpSql, sql, 'utf8');

  try {
    // Push SQL to device
    run(`adb push "${tmpSql}" /data/local/tmp/e2e_auth.sql`);
    // Execute against RKStorage
    run(`adb shell "sqlite3 ${DB_PATH} < /data/local/tmp/e2e_auth.sql"`);
    // Clean up temp file on device
    run(`adb shell rm /data/local/tmp/e2e_auth.sql`);
    console.log('[ci-seed-auth] ✅ Session injected into Android AsyncStorage');
  } finally {
    try { unlinkSync(tmpSql); } catch { /* ignore */ }
  }
}

// ─── iOS injection via sqlite3 host-side ─────────────────────────────────────
function injectIOS(key, value) {
  // Find the RKStorage SQLite file inside the simulator sandbox for our app.
  // @react-native-async-storage places it at:
  //   {Sandbox}/Documents/RKStorage  (v1.x)
  //   {Sandbox}/Library/Application Support/RKStorage  (some v2.x builds)
  // We search both locations.
  let dbPath = findIOSDb();

  if (!dbPath) {
    // The DB is only created after the app first reads/writes AsyncStorage.
    // Warm-up launch in the workflow creates it; if still missing, launch again.
    console.log('[ci-seed-auth] RKStorage not found — cold-launching app to create DB...');
    run('xcrun simctl launch booted com.big2mobile.app || true');
    sleep(6);
    run('xcrun simctl terminate booted com.big2mobile.app || true');
    sleep(2);
    dbPath = findIOSDb();
  }

  if (!dbPath) {
    console.error(`[ci-seed-auth] ❌ Could not locate RKStorage for ${APP_ID}.`);
    console.error('    Searched: Documents/RKStorage and Library/Application Support/RKStorage');
    process.exit(1);
  }

  console.log(`[ci-seed-auth] Found RKStorage at: ${dbPath}`);

  const tmpSql = join(tmpdir(), 'e2e_auth_inject.sql');
  const escapedValue = value.replace(/'/g, "''");
  const sql =
    `CREATE TABLE IF NOT EXISTS catalystLocalStorage ` +
    `(key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');\n` +
    `INSERT OR REPLACE INTO catalystLocalStorage (key, value) ` +
    `VALUES ('${key}', '${escapedValue}');`;

  writeFileSync(tmpSql, sql, 'utf8');
  try {
    run(`sqlite3 "${dbPath}" < "${tmpSql}"`);
    console.log('[ci-seed-auth] ✅ Session injected into iOS AsyncStorage');
  } finally {
    try { unlinkSync(tmpSql); } catch { /* ignore */ }
  }
}

function findIOSDb() {
  // Try both known paths
  try {
    const result = execSync(
      `find ~/Library/Developer/CoreSimulator/Devices -name "RKStorage" 2>/dev/null`,
      { encoding: 'utf8', timeout: 15000 }
    );
    const lines = result.trim().split('\n').filter(Boolean);
    // Prefer the path that belongs to our app bundle
    const appPath = lines.find(p => p.includes(APP_ID));
    return appPath || lines[0] || null;
  } catch {
    return null;
  }
}

function run(cmd) {
  console.log(`  $ ${cmd}`);
  const result = spawnSync(cmd, { shell: true, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`[ci-seed-auth] ❌ Command failed (exit ${result.status}): ${cmd}`);
    process.exit(result.status ?? 1);
  }
}

function sleep(seconds) {
  execSync(`sleep ${seconds}`);
}
