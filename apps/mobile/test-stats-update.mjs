#!/usr/bin/env node
// Test script to manually trigger stats update
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
const envPath = join(__dirname, '.env');
const envContent = readFileSync(envPath, 'utf8');

const envVars = {};
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length) {
    envVars[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
  }
});

const supabaseUrl = envVars.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = envVars.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testStatsUpdate() {
  console.log('🧪 Testing manual stats update...\n');
  
  // Get first user from player_stats
  const { data: users, error: userError } = await supabase
    .from('player_stats')
    .select('user_id')
    .limit(1)
    .single();
  
  if (userError || !users) {
    console.error('❌ Error getting user:', userError);
    return;
  }
  
  const testUserId = users.user_id;
  console.log(`📝 Testing with user ID: ${testUserId.substring(0, 8)}...\n`);
  
  // Check before
  const { data: before } = await supabase
    .from('player_stats')
    .select('*')
    .eq('user_id', testUserId)
    .single();
  
  console.log('📊 BEFORE:');
  console.log(`   Games: ${before?.games_played || 0}`);
  console.log(`   Wins: ${before?.games_won || 0}`);
  console.log(`   Points: ${before?.rank_points || 0}\n`);
  
  // Call the RPC function
  console.log('🚀 Calling update_player_stats_after_game...\n');
  const { data, error } = await supabase.rpc('update_player_stats_after_game', {
    p_user_id: testUserId,
    p_won: true,
    p_finish_position: 1,
    p_score: 50,
    p_combos_played: {
      singles: 5,
      pairs: 3,
      triples: 1,
      straights: 0,
      full_houses: 0,
      four_of_a_kinds: 0,
      straight_flushes: 0,
      royal_flushes: 0
    }
  });
  
  if (error) {
    console.error('❌ RPC ERROR:', error);
    console.error('   Message:', error.message);
    console.error('   Details:', error.details);
    console.error('   Hint:', error.hint);
    console.error('   Code:', error.code);
  } else {
    console.log('✅ RPC call successful!\n');
    
    // Check after
    const { data: after } = await supabase
      .from('player_stats')
      .select('*')
      .eq('user_id', testUserId)
      .single();
    
    console.log('📊 AFTER:');
    console.log(`   Games: ${after?.games_played || 0}`);
    console.log(`   Wins: ${after?.games_won || 0}`);
    console.log(`   Points: ${after?.rank_points || 0}`);
    console.log(`   Win Rate: ${after?.win_rate || 0}%`);
    
    if (after && before && after.games_played > before.games_played) {
      console.log('\n✅ Stats updated successfully!');
    } else {
      console.log('\n⚠️  Stats did NOT update (same values)');
    }
  }
}

testStatsUpdate().catch(console.error);
