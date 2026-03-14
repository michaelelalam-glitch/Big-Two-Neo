/**
 * Check if game_state table exists in schema
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
const supabaseServiceKey = envVars.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkSchema() {
  console.log('🔍 [Schema Check] Verifying game_state table...\n');

  // Check table structure using service role
  const { data, error } = await supabase.rpc('exec_sql', {
    sql_query: `
      SELECT 
        column_name,
        data_type,
        is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'game_state'
      ORDER BY ordinal_position;
    `
  });

  if (error) {
    console.log('⚠️  Cannot query schema (expected if RPC not available)');
    console.log('Attempting alternative method...\n');
    
    // Try direct query
    const { data: tableData, error: tableError } = await supabase
      .from('game_state')
      .select('*')
      .limit(0);
      
    if (tableError) {
      console.error('❌ game_state table does NOT exist or is not accessible');
      console.error('Error:', tableError.message);
    } else {
      console.log('✅ game_state table exists (empty query succeeded)');
    }
    return;
  }

  if (!data || data.length === 0) {
    console.error('❌ game_state table NOT FOUND in schema!');
    return;
  }

  console.log(`✅ game_state table found with ${data.length} columns:\n`);
  data.forEach(col => {
    console.log(`  - ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'NOT NULL'})`);
  });
  
  // Check for RLS policies
  console.log('\n🔒 [RLS Check] Checking row-level security...\n');
  
  const { data: rlsData, error: rlsError } = await supabase.rpc('exec_sql', {
    sql_query: `
      SELECT 
        tablename,
        policyname,
        permissive,
        roles,
        cmd,
        qual
      FROM pg_policies
      WHERE tablename = 'game_state';
    `
  });

  if (rlsError || !rlsData || rlsData.length === 0) {
    console.log('⚠️  No RLS policies found or cannot query pg_policies');
  } else {
    console.log(`Found ${rlsData.length} RLS policies:`);
    rlsData.forEach(policy => {
      console.log(`\n  Policy: ${policy.policyname}`);
      console.log(`    Type: ${policy.cmd}`);
      console.log(`    Roles: ${policy.roles.join(', ')}`);
    });
  }
}

checkSchema().catch(console.error);
