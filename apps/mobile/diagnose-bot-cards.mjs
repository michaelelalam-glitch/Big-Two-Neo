import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dppybucldqufbqhwnkxu.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwcHlidWNsZHF1ZmJxaHdua3h1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5MzEyNjMsImV4cCI6MjA3OTUwNzI2M30.NPr-oBDZrfJisJH5rzosMMYTL3GKbIVQ_nllmaTxyFE';

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
