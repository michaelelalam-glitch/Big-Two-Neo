#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Read SQL file
const sql = readFileSync('./supabase/migrations/20251223000001_add_client_game_completion.sql', 'utf8');

console.log('Applying migration: 20251223000001_add_client_game_completion.sql');
console.log('SQL length:', sql.length);

// Execute SQL
const { data, error } = await supabase.rpc('exec', { sql });

if (error) {
  console.error('❌ Migration failed:', error);
  process.exit(1);
}

console.log('✅ Migration applied successfully!');
console.log('Result:', data);
