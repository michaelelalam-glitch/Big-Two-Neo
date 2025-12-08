#!/usr/bin/env node
// Quick script to check player_stats and leaderboard_global data
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
const envPath = join(__dirname, '.env');
let envContent;
try {
  envContent = readFileSync(envPath, 'utf8');
} catch (err) {
  console.error('❌ Could not read .env file at:', envPath);
  process.exit(1);
}

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
  console.error('❌ Missing Supabase credentials in .env');
  console.error('EXPO_PUBLIC_SUPABASE_URL:', supabaseUrl ? 'Found' : 'Missing');
  console.error('EXPO_PUBLIC_SUPABASE_ANON_KEY:', supabaseKey ? 'Found' : 'Missing');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkPlayerStats() {
  console.log('🏆 Checking Player Stats & Leaderboard Data...\n');
  console.log('='.repeat(80));
  
  // Check player_stats table
  console.log('\n📊 PLAYER_STATS TABLE:');
  const { data: statsData, error: statsError } = await supabase
    .from('player_stats')
    .select('*')
    .order('rank_points', { ascending: false })
    .limit(10);
  
  if (statsError) {
    console.error('❌ Error fetching player_stats:', statsError);
  } else if (statsData && statsData.length > 0) {
    console.log(`✅ Found ${statsData.length} player stat entries:\n`);
    statsData.forEach((entry, idx) => {
      console.log(`${idx + 1}. User ID: ${entry.user_id.substring(0, 8)}...`);
      console.log(`   Games: ${entry.games_played} | Wins: ${entry.games_won} | Win Rate: ${entry.win_rate}%`);
      console.log(`   Rank Points: ${entry.rank_points} | Streak: ${entry.current_win_streak}`);
      console.log('');
    });
  } else {
    console.log('❌ No player_stats entries found!');
  }
  
  console.log('='.repeat(80));
  
  // Check leaderboard_global materialized view
  console.log('\n🌍 LEADERBOARD_GLOBAL MATERIALIZED VIEW:');
  const { data: leaderboardData, error: leaderboardError } = await supabase
    .from('leaderboard_global')
    .select('*')
    .limit(10);
  
  if (leaderboardError) {
    console.error('❌ Error fetching leaderboard_global:', leaderboardError);
    console.error('   This might mean the materialized view needs to be refreshed!');
  } else if (leaderboardData && leaderboardData.length > 0) {
    console.log(`✅ Found ${leaderboardData.length} leaderboard entries:\n`);
    leaderboardData.forEach((entry, idx) => {
      console.log(`${idx + 1}. Rank #${entry.rank}: ${entry.username}`);
      console.log(`   Games: ${entry.games_played} | Wins: ${entry.games_won} | Win Rate: ${entry.win_rate}%`);
      console.log(`   Rank Points: ${entry.rank_points}`);
      console.log('');
    });
  } else {
    console.log('❌ No leaderboard_global entries found!');
    console.log('   This likely means the materialized view needs to be refreshed.');
  }
  
  console.log('='.repeat(80));
  
  // Check if materialized view exists
  console.log('\n🔍 CHECKING MATERIALIZED VIEW STATUS:');
  const { error: viewError } = await supabase
    .rpc('refresh_leaderboard');
  
  if (viewError) {
    console.error('❌ Error calling refresh_leaderboard():', viewError);
    console.log('   You may need to manually refresh the view in SQL');
  } else {
    console.log('✅ Successfully called refresh_leaderboard()');
    
    // Re-check after refresh
    const { data: refreshedData, error: refreshError } = await supabase
      .from('leaderboard_global')
      .select('*')
      .limit(5);
    
    if (!refreshError && refreshedData && refreshedData.length > 0) {
      console.log(`✅ After refresh: Found ${refreshedData.length} entries`);
    } else {
      console.log('⚠️  After refresh: Still no entries found');
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('\n💡 TROUBLESHOOTING TIPS:');
  console.log('   1. If player_stats has data but leaderboard_global is empty:');
  console.log('      → The materialized view needs manual refresh');
  console.log('      → Run: REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_global;');
  console.log('   2. If player_stats is empty:');
  console.log('      → Games aren\'t saving stats (check game completion code)');
  console.log('   3. If both are empty:');
  console.log('      → Check if migration ran successfully\n');
}

checkPlayerStats().catch(console.error);
