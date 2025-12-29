/**
 * Test start_game_with_bots RPC directly
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

// Use anon key with user auth
const supabase = createClient(supabaseUrl, supabaseKey);

async function testStartGame() {
  console.log('🎮 [Test] Testing start_game_with_bots RPC...\n');

  // First, sign in as the test user
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'michael.elalam01@gmail.com',
    password: 'your_password_here', // REPLACE WITH ACTUAL PASSWORD
  });

  if (authError) {
    console.error('❌ [Auth] Failed to sign in:', authError.message);
    console.log('Please update the password in this script');
    return;
  }

  console.log('✅ [Auth] Signed in as:', authData.user.email);

  // Create a test room
  console.log('\n📦 [Test] Creating test room...');
  const { data: roomData, error: roomError } = await supabase
    .from('rooms')
    .insert({
      host_id: authData.user.id,
      status: 'waiting',
      ranked_mode: false,
    })
    .select()
    .single();

  if (roomError) {
    console.error('❌ [Test] Failed to create room:', roomError.message);
    return;
  }

  console.log('✅ [Test] Room created:', roomData.id);

  // Add host as player
  console.log('\n👤 [Test] Adding host as player...');
  const { error: playerError } = await supabase
    .from('room_players')
    .insert({
      room_id: roomData.id,
      user_id: authData.user.id,
      username: 'Test Player',
      player_index: 0,
      is_bot: false,
      is_host: true,
      is_ready: false,
    });

  if (playerError) {
    console.error('❌ [Test] Failed to add player:', playerError.message);
    return;
  }

  console.log('✅ [Test] Host added as player');

  // Call start_game_with_bots
  console.log('\n🚀 [Test] Calling start_game_with_bots...');
  const { data: gameData, error: gameError } = await supabase
    .rpc('start_game_with_bots', {
      p_room_id: roomData.id,
      p_bot_count: 3,
      p_bot_difficulty: 'medium',
    });

  if (gameError) {
    console.error('❌ [Test] RPC failed:', gameError.message);
    return;
  }

  console.log('✅ [Test] RPC Response:', JSON.stringify(gameData, null, 2));

  // Check if game_state was created
  console.log('\n📊 [Test] Checking game_state...');
  const { data: stateData, error: stateError } = await supabase
    .from('game_state')
    .select('room_id, hands, current_turn, game_phase')
    .eq('room_id', roomData.id)
    .single();

  if (stateError) {
    console.error('❌ [Test] game_state NOT created:', stateError.message);
    return;
  }

  console.log('✅ [Test] game_state EXISTS!');
  console.log('  Current Turn:', stateData.current_turn);
  console.log('  Game Phase:', stateData.game_phase);
  console.log('  Hands keys:', stateData.hands ? Object.keys(stateData.hands).join(', ') : 'null');
  
  if (stateData.hands) {
    Object.keys(stateData.hands).forEach(key => {
      const hand = stateData.hands[key];
      console.log(`    Player ${key}: ${Array.isArray(hand) ? hand.length : 0} cards`);
      if (Array.isArray(hand) && hand.length > 0) {
        console.log(`      First 3 cards: ${hand.slice(0, 3).map(c => c.id).join(', ')}`);
      }
    });
  }

  // Cleanup
  console.log('\n🧹 [Test] Cleaning up test room...');
  await supabase.from('rooms').delete().eq('id', roomData.id);
  console.log('✅ [Test] Cleanup complete');
}

testStartGame().catch(console.error);
