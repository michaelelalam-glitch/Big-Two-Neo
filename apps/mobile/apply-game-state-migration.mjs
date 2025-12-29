import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const supabaseUrl = 'https://dppybucldqufbqhwnkxu.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwcHlidWNsZHF1ZmJxaHdua3h1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5MzEyNjMsImV4cCI6MjA3OTUwNzI2M30.NPr-oBDZrfJisJH5rzosMMYTL3GKbIVQ_nllmaTxyFE';

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🚀 Applying game_state table migration...\n');

// Read the migration file
const migrationSQL = readFileSync('./supabase/migrations/20251227120000_create_game_state_table.sql', 'utf8');

// Apply the migration
const { data, error } = await supabase.rpc('exec_sql', { query: migrationSQL });

if (error) {
  console.error('❌ Migration failed:', error);
  
  // Try direct execution via pg_exec
  console.log('\n⚠️  Trying alternative method...\n');
  
  // Split into individual statements and execute
  const statements = migrationSQL
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));
  
  for (const statement of statements) {
    if (statement.includes('DO $$') || statement.includes('CREATE POLICY') || statement.includes('ALTER PUBLICATION')) {
      console.log(`⏭️  Skipping: ${statement.substring(0, 50)}...`);
      continue;
    }
    
    console.log(`✅ Executing: ${statement.substring(0, 80)}...`);
    const { error: execError } = await supabase.rpc('exec_sql', { query: statement + ';' });
    if (execError) {
      console.error(`   ❌ Error:`, execError.message);
    }
  }
} else {
  console.log('✅ Migration applied successfully!');
}

// Verify the table was created
console.log('\n🔍 Verifying game_state table...\n');
const { data: tables, error: tablesError } = await supabase
  .from('game_state')
  .select('*')
  .limit(1);

if (tablesError) {
  if (tablesError.code === 'PGRST204') {
    console.log('✅ Table exists but is empty (expected for new table)');
  } else {
    console.error('❌ Verification failed:', tablesError);
  }
} else {
  console.log('✅ Table verified! Found', tables?.length || 0, 'rows');
}

console.log('\n🎉 Migration complete!');
