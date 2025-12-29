import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dppybucldqufbqhwnkxu.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwcHlidWNsZHF1ZmJxaHdua3h1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5MzEyNjMsImV4cCI6MjA3OTUwNzI2M30.NPr-oBDZrfJisJH5rzosMMYTL3GKbIVQ_nllmaTxyFE';

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🧹 Cleaning up stuck rooms without game_state...\n');

// Find all playing rooms without game_state
const { data: rooms } = await supabase
  .from('rooms')
  .select('id, code, status, created_at')
  .eq('status', 'playing');

if (!rooms || rooms.length === 0) {
  console.log('✅ No rooms to clean up');
  process.exit(0);
}

let cleanedCount = 0;

for (const room of rooms) {
  // Check if game_state exists
  const { data: gameState } = await supabase
    .from('game_state')
    .select('id')
    .eq('room_id', room.id)
    .maybeSingle();
  
  if (!gameState) {
    console.log(`🗑️  Cleaning room ${room.code} (no game_state)...`);
    
    // Reset to waiting status
    const { error } = await supabase
      .from('rooms')
      .update({ status: 'waiting' })
      .eq('id', room.id);
    
    if (error) {
      console.log(`   ❌ Error: ${error.message}`);
    } else {
      console.log(`   ✅ Reset to waiting`);
      cleanedCount++;
    }
  }
}

console.log(`\n✅ Cleaned up ${cleanedCount} stuck room(s)!`);
console.log('\n💡 Now start a fresh game with bots!');
