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
