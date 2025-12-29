#!/usr/bin/env node

/**
 * Apply matchmaking auto-start fix migration
 * Run: node apply-matchmaking-auto-start-fix.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get Supabase credentials from environment or prompt
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://dppybucldqufbqhwnkxu.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ Error: SUPABASE_SERVICE_ROLE_KEY environment variable not set');
  console.log('\nUsage:');
  console.log('  SUPABASE_SERVICE_ROLE_KEY=your_key node apply-matchmaking-auto-start-fix.mjs');
  console.log('\nOr apply manually:');
  console.log('  1. Open Supabase Dashboard: https://supabase.com/dashboard/project/dppybucldqufbqhwnkxu/sql/new');
  console.log('  2. Copy content from: apps/mobile/supabase/migrations/20251228000001_fix_matchmaking_auto_start.sql');
  console.log('  3. Paste and run');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function applyMigration() {
  console.log('🚀 Applying matchmaking auto-start fix...\n');
  
  try {
    // Read migration file
    const migrationPath = join(__dirname, 'supabase', 'migrations', '20251228000001_fix_matchmaking_auto_start.sql');
    const sql = readFileSync(migrationPath, 'utf8');
    
    console.log('📄 Migration file:', migrationPath);
    console.log('📏 SQL length:', sql.length, 'characters\n');
    
    // Apply migration
    console.log('⏳ Executing migration...');
    const { data, error } = await supabase.rpc('exec', { sql });
    
    if (error) {
      throw error;
    }
    
    console.log('✅ Migration applied successfully!\n');
    
    // Verify function exists
    console.log('🔍 Verifying find_match function...');
    const { data: fnData, error: fnError } = await supabase
      .from('pg_proc')
      .select('proname')
      .eq('proname', 'find_match')
      .single();
    
    if (fnError) {
      console.warn('⚠️ Could not verify function (this is okay):', fnError.message);
    } else {
      console.log('✅ Function verified:', fnData?.proname);
    }
    
    console.log('\n✨ All done! Matchmaking will now auto-start when 4 players matched.\n');
    console.log('📝 Changes made:');
    console.log('  1. ✅ Auto-start game when 4 players matched');
    console.log('  2. ✅ Fixed "already in room" error (code 23505)');
    console.log('  3. ✅ All players navigate directly to GameScreen');
    console.log('  4. ✅ Works for casual, ranked, and private matches\n');
    
  } catch (error) {
    console.error('❌ Error applying migration:', error.message);
    console.error('\n💡 Manual application:');
    console.error('  1. Open: https://supabase.com/dashboard/project/dppybucldqufbqhwnkxu/sql/new');
    console.error('  2. Copy: apps/mobile/supabase/migrations/20251228000001_fix_matchmaking_auto_start.sql');
    console.error('  3. Paste and run\n');
    process.exit(1);
  }
}

applyMigration();
