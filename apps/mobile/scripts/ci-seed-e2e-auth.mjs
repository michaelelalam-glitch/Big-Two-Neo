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
import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
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
// Supabase JS v2 default storage key: sb-{project-ref}-auth-token
// where project-ref = hostname.split('.')[0]  (e.g. "dppybucldqufbqhwnkxu")
const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
const STORAGE_KEY = `sb-${projectRef}-auth-token`;

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
// async-storage v2 uses an "AsyncStorage" database with a "Storage" table.
// Fall back to the old "RKStorage"/"catalystLocalStorage" schema for v1 installs.
function injectAndroid(key, value) {
  const NEW_DB = `/data/data/${APP_ID}/databases/AsyncStorage`;
  const OLD_DB = `/data/data/${APP_ID}/databases/RKStorage`;

  const tmpSql = join(tmpdir(), 'e2e_auth_inject.sql');
  const escapedValue = value.replace(/'/g, "''");

  // v2 schema (async-storage >= 2.0)
  const newSql =
    `CREATE TABLE IF NOT EXISTS "Storage" ("key" TEXT NOT NULL, "value" TEXT, PRIMARY KEY("key"));\n` +
    `INSERT OR REPLACE INTO "Storage" ("key", "value") VALUES ('${key}', '${escapedValue}');`;

  // v1 legacy schema
  const oldSql =
    `CREATE TABLE IF NOT EXISTS catalystLocalStorage ` +
    `(key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');\n` +
    `INSERT OR REPLACE INTO catalystLocalStorage (key, value) ` +
    `VALUES ('${key}', '${escapedValue}');`;

  writeFileSync(tmpSql, newSql, 'utf8');
  try {
    run(`adb push "${tmpSql}" /data/local/tmp/e2e_auth.sql`);
    // Try v2 AsyncStorage db first (sqlite3 creates it if it doesn't exist yet)
    const result = spawnSync(
      `adb shell "sqlite3 ${NEW_DB} < /data/local/tmp/e2e_auth.sql"`,
      { shell: true, stdio: 'pipe' },
    );
    if (result.status !== 0) {
      // v2 db not available — fall back to legacy RKStorage
      console.log('[ci-seed-auth] AsyncStorage db unavailable — trying legacy RKStorage...');
      writeFileSync(tmpSql, oldSql, 'utf8');
      run(`adb push "${tmpSql}" /data/local/tmp/e2e_auth.sql`);
      run(`adb shell "sqlite3 ${OLD_DB} < /data/local/tmp/e2e_auth.sql"`);
    }
    run(`adb shell rm /data/local/tmp/e2e_auth.sql`);
    console.log('[ci-seed-auth] ✅ Session injected into Android AsyncStorage');
  } finally {
    try { unlinkSync(tmpSql); } catch { /* ignore */ }
  }
}

// ─── iOS injection (host-side) ────────────────────────────────────────────────
// async-storage v2 stores keys as individual files inside a per-bundle
// directory rather than a SQLite database:
//   {Sandbox}/Library/Application Support/{bundleId}/RCTAsyncLocalStorage_V1/
// Each key is stored as a file named MD5(key). Values > 1024 bytes are stored
// in the file; manifest.json records {key: null} for those entries.
// We always write the value as a file (auth session ~1840 bytes > 1024 threshold).
// Fall back to the old RKStorage SQLite schema for v1 installs.
function injectIOS(key, value) {
  // ── Try v2 file-based storage first ──────────────────────────────────────
  let storageDir = findIOSStorageV2();

  if (storageDir) {
    injectIOSv2(key, value, storageDir);
    return;
  }

  // ── Try to find/create parent dir then create the v2 storage directory ──
  storageDir = findOrCreateIOSStorageV2();
  if (storageDir) {
    injectIOSv2(key, value, storageDir);
    return;
  }

  // ── Fall back to old RKStorage SQLite (async-storage v1) ─────────────────
  let dbPath = findIOSDb();
  if (!dbPath) {
    console.log('[ci-seed-auth] Storage not found — cold-launching app to initialise storage...');
    run('xcrun simctl launch booted com.big2mobile.app || true');
    sleep(6);
    run('xcrun simctl terminate booted com.big2mobile.app || true');
    sleep(2);
    // Re-check both formats after launch
    storageDir = findIOSStorageV2() || findOrCreateIOSStorageV2();
    if (storageDir) {
      injectIOSv2(key, value, storageDir);
      return;
    }
    dbPath = findIOSDb();
  }

  if (!dbPath) {
    console.error(`[ci-seed-auth] ❌ Could not locate AsyncStorage for ${APP_ID}.`);
    process.exit(1);
  }

  // Inject into v1 SQLite
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
    console.log('[ci-seed-auth] ✅ Session injected into iOS RKStorage (v1 fallback)');
  } finally {
    try { unlinkSync(tmpSql); } catch { /* ignore */ }
  }
}

/** Find existing RCTAsyncLocalStorage_V1 directory in simulator sandbox. */
function findIOSStorageV2() {
  try {
    const result = execSync(
      `find ~/Library/Developer/CoreSimulator/Devices -path "*/${APP_ID}/RCTAsyncLocalStorage_V1" -type d 2>/dev/null`,
      { encoding: 'utf8', timeout: 15000 },
    );
    const lines = result.trim().split('\n').filter(Boolean);
    return lines[0] || null;
  } catch {
    return null;
  }
}

/**
 * Find the app's Application Support directory and create
 * RCTAsyncLocalStorage_V1 inside it (app sandbox exists but storage dir
 * not yet initialised by the library).
 */
function findOrCreateIOSStorageV2() {
  try {
    const result = execSync(
      `find ~/Library/Developer/CoreSimulator/Devices -path "*/Library/Application Support/${APP_ID}" -type d 2>/dev/null`,
      { encoding: 'utf8', timeout: 15000 },
    );
    const lines = result.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return null;
    const storageDir = join(lines[0], 'RCTAsyncLocalStorage_V1');
    mkdirSync(storageDir, { recursive: true });
    return storageDir;
  } catch {
    return null;
  }
}

/**
 * Write key into RCTAsyncLocalStorage_V1 directory (async-storage v2 format):
 *   - value file: {storageDir}/{MD5(key)}
 *   - manifest.json: {key: null}  (null = value stored in file, not inline)
 */
function injectIOSv2(key, value, storageDir) {
  const md5 = createHash('md5').update(key, 'utf8').digest('hex');
  const keyFilePath = join(storageDir, md5);
  const manifestPath = join(storageDir, 'manifest.json');

  writeFileSync(keyFilePath, value, 'utf8');

  let manifest = {};
  if (existsSync(manifestPath)) {
    try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { manifest = {}; }
  }
  manifest[key] = null; // null = value is in separate file (not inlined)
  writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');

  console.log(`[ci-seed-auth] ✅ Session injected into iOS RCTAsyncLocalStorage_V1 (${md5})`);
}

/** Find RKStorage SQLite file (async-storage v1 legacy). */
function findIOSDb() {
  try {
    const result = execSync(
      `find ~/Library/Developer/CoreSimulator/Devices -name "RKStorage" 2>/dev/null`,
      { encoding: 'utf8', timeout: 15000 },
    );
    const lines = result.trim().split('\n').filter(Boolean);
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
