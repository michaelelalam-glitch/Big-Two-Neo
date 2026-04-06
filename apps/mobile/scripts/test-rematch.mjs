#!/usr/bin/env node
/**
 * test-rematch.mjs — Integration test for the Play Again / rematch flow.
 *
 * What it tests (without playing a full game):
 *   1. Creates a finished room + game_history row directly via service role
 *   2. Signs in as 2–4 real test users with user JWT tokens
 *   3. Calls get_or_create_rematch_room from each user concurrently
 *   4. Asserts all users joined the SAME new room (not separate rooms)
 *   5. Cleans up all rows it created
 *
 * Setup (one-time):
 *   1. Get your service role key from the Supabase dashboard → Project Settings → API
 *   2. Create/have 2+ real accounts in the app (or via Supabase Auth dashboard)
 *   3. Set env vars (copy the block below into a .env.test.local file or export inline):
 *
 *      SUPABASE_SERVICE_ROLE_KEY=eyJ...   # required
 *      TEST_USER_1_EMAIL=alice@test.com   # required
 *      TEST_USER_1_PASSWORD=password123   # required
 *      TEST_USER_2_EMAIL=bob@test.com     # required
 *      TEST_USER_2_PASSWORD=password456   # required
 *      TEST_USER_3_EMAIL=...              # optional
 *      TEST_USER_4_EMAIL=...              # optional
 *
 * Run:
 *   node apps/mobile/scripts/test-rematch.mjs
 *   # or with inline env vars:
 *   SUPABASE_SERVICE_ROLE_KEY=... TEST_USER_1_EMAIL=... node apps/mobile/scripts/test-rematch.mjs
 *
 * Multi-device testing:
 *   You can have real people on physical devices sign in as these test accounts
 *   and run the game manually while this script sets up the finished game state
 *   beforehand, or just use the script end-to-end for quick headless verification.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env.test.local if it exists (optional convenience) ────────────────
const envFile = join(__dirname, '../.env.test.local');
if (existsSync(envFile)) {
  const lines = readFileSync(envFile, 'utf8').split('\n');
  for (const line of lines) {
    const [key, ...rest] = line.trim().split('=');
    if (key && rest.length && !process.env[key]) {
      process.env[key] = rest.join('=').replace(/^['"]|['"]$/g, '');
    }
  }
}

// ── Config ───────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const missing = [
  !SUPABASE_URL && 'SUPABASE_URL',
  !SUPABASE_ANON_KEY && 'SUPABASE_ANON_KEY',
  !SERVICE_ROLE_KEY && 'SUPABASE_SERVICE_ROLE_KEY',
].filter(Boolean);

if (missing.length > 0) {
  console.error(
    '\n❌  Missing required environment variable(s): ' +
      `${missing.join(', ')}.\n` +
      '   Set them in your shell or in apps/mobile/.env.test.local before running this script.\n' +
      '   Required:\n' +
      '     SUPABASE_URL=https://your-project.supabase.co\n' +
      '     SUPABASE_ANON_KEY=eyJ...\n' +
      '     SUPABASE_SERVICE_ROLE_KEY=eyJ...\n'
  );
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function generateRoomCode() {
  // Same charset as the DB generate_room_code_v2() function
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function signIn(email, password) {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return { client, user: data.user };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // 1. Collect test user credentials from env
  const rawUsers = [];
  for (let i = 1; i <= 4; i++) {
    const email = process.env[`TEST_USER_${i}_EMAIL`];
    const password = process.env[`TEST_USER_${i}_PASSWORD`];
    if (email && password) rawUsers.push({ email, password });
  }

  if (rawUsers.length < 2) {
    console.error(
      '\n❌  Need at least 2 test users.\n' +
        '   Set: TEST_USER_1_EMAIL, TEST_USER_1_PASSWORD, TEST_USER_2_EMAIL, TEST_USER_2_PASSWORD\n'
    );
    process.exit(1);
  }

  console.log(`\n🔐  Signing in ${rawUsers.length} test user(s)...`);
  const users = await Promise.all(rawUsers.map(({ email, password }) => signIn(email, password)));
  console.log('    ✓', users.map(u => u.user.email).join(', '));

  // 2. Create a "finished" room directly via service role (skips playing the game)
  const roomCode = generateRoomCode();
  const now = new Date().toISOString();
  const startedAt = new Date(Date.now() - 120_000).toISOString();

  console.log(`\n🏠  Creating finished room ${roomCode}...`);
  const { data: room, error: roomErr } = await adminClient
    .from('rooms')
    .insert({
      code: roomCode,
      host_id: users[0].user.id,
      status: 'finished',
      max_players: 4,
      is_public: false,
      is_matchmaking: false,
      ranked_mode: false,
    })
    .select('id')
    .single();

  if (roomErr) throw new Error(`Failed to create room: ${roomErr.message}`);
  console.log('    ✓ room id:', room.id);

  // 3. Insert a game_history row so the RPC can verify participation
  console.log('\n📋  Inserting game_history record...');
  const historyRow = {
    room_id: room.id,
    room_code: roomCode,
    game_type: 'private',
    winner_id: users[0].user.id,
    player_1_id: users[0].user.id,
    player_1_username: users[0].user.email?.split('@')[0] ?? 'Player1',
    player_1_score: 0,
    player_1_was_bot: false,
    player_1_disconnected: false,
    player_1_cards_left: 0,
    player_2_id: users[1].user.id,
    player_2_username: users[1].user.email?.split('@')[0] ?? 'Player2',
    player_2_score: 25,
    player_2_was_bot: false,
    player_2_disconnected: false,
    player_2_cards_left: 5,
    // Pad slots 3 & 4 with the same users if fewer than 4 provided
    player_3_id: (users[2] ?? users[1]).user.id,
    player_3_username: (users[2] ?? users[1]).user.email?.split('@')[0] ?? 'Player3',
    player_3_score: 40,
    player_3_was_bot: !users[2],
    player_3_disconnected: false,
    player_3_cards_left: 8,
    player_4_id: (users[3] ?? users[1]).user.id,
    player_4_username: (users[3] ?? users[1]).user.email?.split('@')[0] ?? 'Player4',
    player_4_score: 60,
    player_4_was_bot: !users[3],
    player_4_disconnected: false,
    player_4_cards_left: 13,
    game_duration_seconds: 120,
    game_completed: true,
    started_at: startedAt,
    finished_at: now,
    game_mode: 'online_private',
  };

  const { error: histErr } = await adminClient.from('game_history').insert(historyRow);
  if (histErr) throw new Error(`Failed to insert game_history: ${histErr.message}`);
  console.log('    ✓ game_history inserted');

  // 4. Call get_or_create_rematch_room from each user concurrently
  //    (simulates all players pressing Play Again at the same time)
  const uniqueUsers = users.slice(0, Math.min(users.length, 4));
  console.log(`\n🔄  Calling get_or_create_rematch_room for ${uniqueUsers.length} users concurrently...`);

  const results = await Promise.allSettled(
    uniqueUsers.map(({ client, user }, i) =>
      client.rpc('get_or_create_rematch_room', {
        p_source_room_id: room.id,
        p_user_id: user.id,
        p_username: user.email?.split('@')[0] ?? `TestUser${i + 1}`,
        p_is_public: false,
        p_is_matchmaking: false,
        p_ranked_mode: false,
      })
    )
  );

  // 5. Evaluate results
  console.log('\n📊  Results:');
  let rematchRoomId = null;
  let passed = true;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const email = uniqueUsers[i].user.email;
    if (r.status === 'rejected') {
      console.log(`    ❌ User ${i + 1} (${email}): rejected — ${r.reason}`);
      passed = false;
    } else if (r.value.error) {
      console.log(
        `    ❌ User ${i + 1} (${email}): RPC error — ${r.value.error.message} (code: ${r.value.error.code})`
      );
      passed = false;
    } else {
      const d = r.value.data;
      console.log(
        `    ✓  User ${i + 1} (${email}): room ${d.room_code} (is_host: ${d.is_host})`
      );
      if (rematchRoomId === null) {
        rematchRoomId = d.room_id;
      } else if (rematchRoomId !== d.room_id) {
        console.log(`       ⚠️  Different room id! Expected ${rematchRoomId}, got ${d.room_id}`);
        passed = false;
      }
    }
  }

  if (passed && rematchRoomId) {
    console.log('\n✅  PASS — All users joined the same rematch room:', rematchRoomId);
  } else {
    console.log('\n❌  FAIL — See errors above');
  }

  // 6. Cleanup — delete the rooms we created
  console.log('\n🧹  Cleaning up...');
  if (rematchRoomId) {
    const { error: e } = await adminClient.from('rooms').delete().eq('id', rematchRoomId);
    if (e) console.warn('    ⚠️  Could not delete rematch room:', e.message);
    else console.log('    ✓ rematch room deleted');
  }
  const { error: e2 } = await adminClient.from('rooms').delete().eq('id', room.id);
  if (e2) console.warn('    ⚠️  Could not delete source room:', e2.message);
  else console.log('    ✓ source room deleted');

  console.log('\nDone.\n');
  process.exit(passed ? 0 : 1);
}

main().catch(err => {
  console.error('\n❌  Unexpected error:', err.message ?? err);
  process.exit(1);
});
