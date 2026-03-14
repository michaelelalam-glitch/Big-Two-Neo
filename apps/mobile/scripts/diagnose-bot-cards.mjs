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
  console.error('❌ Missing Supabase credentials — create apps/mobile/scripts/.env with EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔍 Checking current game state...\n');

// Find most recent playing room
const { data: rooms, error: roomError } = await supabase
  .from('rooms')
  .select('*')
  .eq('status', 'playing')
  .order('created_at', { ascending: false })
  .limit(3);

if (roomError) {
  console.error('❌ Error fetching rooms:', roomError);
  process.exit(1);
}

if (!rooms || rooms.length === 0) {
  console.log('⚠️  No playing rooms found.');
  console.log('✅ Ready for testing! Start a new game with bots.\n');
  process.exit(0);
}

console.log(`📦 Found ${rooms.length} playing room(s):\n`);

for (const room of rooms) {
  console.log(`Room: ${room.code} (${room.id})`);
  console.log(`  Status: ${room.status}`);
  console.log(`  Created: ${room.created_at}`);
  
  // Check game_state
  const { data: gameState, error: stateError } = await supabase
    .from('game_state')
    .select('*')
    .eq('room_id', room.id)
    .maybeSingle();
  
  if (stateError) {
    console.log(`  ❌ Error checking game_state:`, stateError.message);
  } else if (!gameState) {
    console.log(`  ⚠️  NO GAME_STATE FOUND! (This is the bug!)`);
  } else {
    console.log(`  ✅ game_state exists`);
    console.log(`     Current turn: ${gameState.current_turn}`);
    console.log(`     Hands keys: ${gameState.hands ? Object.keys(gameState.hands).join(', ') : 'NONE'}`);
    
    if (gameState.hands) {
      for (const [idx, cards] of Object.entries(gameState.hands)) {
        console.log(`     Player ${idx}: ${Array.isArray(cards) ? cards.length : 'INVALID'} cards`);
      }
    }
  }
  
  // Check players
  const { data: players } = await supabase
    .from('room_players')
    .select('*')
    .eq('room_id', room.id)
    .order('player_index');
  
  if (players) {
    console.log(`  Players (${players.length}):`);
    for (const p of players) {
      console.log(`    [${p.player_index}] ${p.username} ${p.is_bot ? '🤖 BOT' : '👤 HUMAN'}`);
    }
  }
  
  console.log('');
}

console.log('\n💡 NEXT STEPS:');
console.log('  1. If you see "NO GAME_STATE FOUND", the SQL function failed');
console.log('  2. Start a NEW game with bots to test the fix');
console.log('  3. Check logs to see if bots now have cards\n');
