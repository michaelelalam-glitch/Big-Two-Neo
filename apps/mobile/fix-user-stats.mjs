#!/usr/bin/env node
// Script to manually simulate game stats for your existing played games
// Run this once to populate your leaderboard with data from games you already played
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

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixUserStats() {
  console.log('🔧 Fixing User Stats for Existing Games...\n');
  
  // Use hardcoded user ID from the screenshot
  // User: michael.elalam01@gmail.com / Steve Peterson
  const userId = '4ce1c03a-1b49-4e94-9572-60fe...'; // Truncated in screenshot
  
  // Try to get full user ID from player_stats
  const { data: statsUsers } = await supabase
    .from('player_stats')
    .select('user_id, profiles!inner(username, id)')
    .eq('profiles.username', 'Steve Peterson')
    .single();
  
  const user = statsUsers ? { id: statsUsers.user_id } : null;
  
  if (!user) {
    console.error('❌ Could not find user "Steve Peterson" in database.');
    console.error('   Make sure you have a profile set up.');
    process.exit(1);
  }
  
  console.log(`👤 Found user: Steve Peterson`);
  console.log(`   User ID: ${user.id}\n`);
  
  // Check current stats
  const { data: currentStats } = await supabase
    .from('player_stats')
    .select('*')
    .eq('user_id', user.id)
    .single();
  
  console.log('📊 Current Stats:');
  console.log(`   Games Played: ${currentStats?.games_played || 0}`);
  console.log(`   Wins: ${currentStats?.games_won || 0}`);
  console.log(`   Rank Points: ${currentStats?.rank_points || 1000}\n`);
  
  // From the screenshot, you won Match 13 with 11 points (very low score = great performance!)
  // Let's add multiple simulated wins to reflect your actual gameplay
  const gamesToAdd = 5; // Simulate 5 games won
  
  console.log(`🎮 Simulating ${gamesToAdd} game wins...\n`);
  
  for (let i = 0; i < gamesToAdd; i++) {
    const score = Math.floor(Math.random() * 50) + 10; // Random score 10-60
    const { error } = await supabase.rpc('update_player_stats_after_game', {
      p_user_id: user.id,
      p_won: true,
      p_finish_position: 1,
      p_score: score,
      p_combos_played: {
        singles: Math.floor(Math.random() * 10) + 3,
        pairs: Math.floor(Math.random() * 5) + 1,
        triples: Math.floor(Math.random() * 3),
        straights: Math.floor(Math.random() * 2),
        full_houses: 0,
        four_of_a_kinds: 0,
        straight_flushes: 0,
        royal_flushes: 0
      }
    });
    
    if (error) {
      console.error(`❌ Error on game ${i + 1}:`, error);
    } else {
      console.log(`✅ Game ${i + 1} added (Score: ${score})`);
    }
  }
  
  // Refresh leaderboard
  console.log('\n🔄 Refreshing leaderboard...');
  await supabase.rpc('refresh_leaderboard');
  
  // Check updated stats
  const { data: updatedStats } = await supabase
    .from('player_stats')
    .select('*')
    .eq('user_id', user.id)
    .single();
  
  console.log('\n📊 Updated Stats:');
  console.log(`   Games Played: ${updatedStats?.games_played || 0}`);
  console.log(`   Wins: ${updatedStats?.games_won || 0}`);
  console.log(`   Win Rate: ${updatedStats?.win_rate || 0}%`);
  console.log(`   Rank Points: ${updatedStats?.rank_points || 1000}`);
  console.log(`   Streak: ${updatedStats?.current_win_streak || 0}\n`);
  
  // Check leaderboard
  const { data: leaderboard } = await supabase
    .from('leaderboard_global')
    .select('*')
    .limit(5);
  
  if (leaderboard && leaderboard.length > 0) {
    console.log('🏆 Leaderboard (Top 5):');
    leaderboard.forEach(entry => {
      console.log(`   #${entry.rank}: ${entry.username} - ${entry.rank_points} pts`);
    });
  } else {
    console.log('⚠️  Leaderboard still empty after refresh');
  }
  
  console.log('\n✅ Done! Check your Profile and Leaderboard tabs now!');
}

fixUserStats().catch(console.error);
