import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = 'https://dppybucldqufbqhwnkxu.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwcHlidWNsZHF1ZmJxaHdua3h1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczNDI2MTQ1NCwiZXhwIjoyMDQ5ODM3NDU0fQ.A-cWKlp6zPWqiKgTUzXZ7D1ZWBBU3K5k1_v-ky2jSEI';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function applyMigration() {
  console.log('🚀 Applying migration: fix_execute_play_move_json_encoding...');
  
  const migrationPath = path.join(__dirname, 'supabase/migrations/20251227120002_fix_execute_play_move_json_encoding.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  
  // Remove comments and split into statements
  const statements = sql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  
  for (const statement of statements) {
    console.log(`Executing statement (${statement.substring(0, 50)}...)`);
    
    const { data, error } = await supabase.rpc('exec_sql', { sql: statement + ';' });
    
    if (error) {
      // Try direct query if RPC fails
      const { error: error2 } = await supabase.from('_temp').select('*').limit(0); // Dummy to test connection
      
      if (!error2) {
        // Connection works, try a different approach - use POST to edge function
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SERVICE_ROLE_KEY}`
          },
          body: JSON.stringify({ query: statement + ';' })
        });
        
        if (!response.ok) {
          console.error('❌ Migration failed:', error);
          console.error('Response:', await response.text());
          process.exit(1);
        }
      } else {
        console.error('❌ Migration failed:', error);
        process.exit(1);
      }
    }
    
    console.log('✅ Statement executed');
  }
  
  console.log('✅ Migration applied successfully!');
  console.log('\n🔧 NEXT STEP: You need to RESTART YOUR APP or create a NEW GAME to fix corrupted hands!');
  console.log('The existing game has corrupted data - start a fresh game to test the fix.\n');
}

applyMigration().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
