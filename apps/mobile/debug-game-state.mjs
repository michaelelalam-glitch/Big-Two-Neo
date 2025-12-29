/**
 * DEBUG SCRIPT: Verify game_state table structure and RLS policies
 * Run: node debug-game-state.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read .env file manually
const envPath = join(__dirname, '.env');
const envContent = readFileSync(envPath, 'utf-8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length) {
    envVars[key.trim()] = valueParts.join('=').trim();
  }
});

const supabaseUrl = envVars.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = envVars.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function debugGameState() {
  console.log('🔍 [Debug] Checking game_state table...\n');

  // 1. Check if game_state table exists and get structure
  const { data: tables, error: tablesError } = await supabase
    .from('game_state')
    .select('*')
    .limit(1);

  if (tablesError) {
    console.error('❌ [Debug] Cannot read game_state table:',tablesError.message);
    return;
  }

  console.log('✅ [Debug] game_state table exists');
  
  // 2. Find the most recent game
  const { data: recentGames, error: gamesError } = await supabase
    .from('game_state')
    .select('room_id, hands, current_turn, game_phase, game_started_at')
    .order('game_started_at', { ascending: false })
    .limit(5);

  if (gamesError) {
    console.error('❌ [Debug] Error fetching recent games:', gamesError.message);
    return;
  }

  console.log(`\n📊 [Debug] Found ${recentGames?.length || 0} recent games:\n`);
  
  recentGames?.forEach((game, idx) => {
    console.log(`Game ${idx + 1}:`);
    console.log(`  Room ID: ${game.room_id}`);
    console.log(`  Current Turn: ${game.current_turn}`);
    console.log(`  Game Phase: ${game.game_phase}`);
    console.log(`  Started At: ${game.game_started_at}`);
    console.log(`  Hands keys: ${game.hands ? Object.keys(game.hands).join(', ') : 'null'}`);
    
    if (game.hands) {
      Object.keys(game.hands).forEach(key => {
        const hand = game.hands[key];
        console.log(`    Player ${key}: ${Array.isArray(hand) ? hand.length : 0} cards`);
      });
    } else {
      console.log('    ⚠️  NO HANDS DATA!');
    }
    console.log('');
  });

  // 3. Check RLS policies
  console.log('\n🔒 [Debug] Checking RLS policies on game_state...');
  console.log('(This requires service role key to query pg_policies directly)');
  console.log('Attempting read with anon key to test policy...\n');

  // Try to read with anon key (simulates client access)
  const { data: testRead, error: readError } = await supabase
    .from('game_state')
    .select('*')
    .limit(1)
    .maybeSingle();

  if (readError) {
    console.error('❌ [Debug] RLS may be blocking reads:', readError.message);
  } else {
    console.log('✅ [Debug] Can read game_state with anon key');
  }
}

debugGameState().catch(console.error);
