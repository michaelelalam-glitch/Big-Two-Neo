#!/usr/bin/env node

/**
 * Update Task Status to in_review
 * Updates tasks #258 and #259 to "in_review" status
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ycvzufhaqplbpajhqjog.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_ANON_KEY) {
  console.error('❌ SUPABASE_ANON_KEY environment variable not set');
  console.log('Usage: SUPABASE_ANON_KEY=your_key node update-tasks-to-review.js');
  process.exit(1);
}

async function updateTask(taskId, updates) {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/tasks?id=eq.${taskId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(updates)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }

    const data = await response.json();
    return data[0];
  } catch (error) {
    console.error(`Error updating task ${taskId}:`, error.message);
    throw error;
  }
}

async function main() {
  console.log('🔄 Updating tasks #258 and #259 to in_review status...\n');

  try {
    // Update Task #258: Design Figma UI/UX mockups for mobile
    console.log('Updating Task #258: Design Figma UI/UX mockups for mobile');
    await updateTask(258, {
      status: 'in_review',
      updated_at: new Date().toISOString()
    });
    console.log('✅ Task #258 updated to in_review\n');

    // Update Task #259: Set up mobile project with Expo/React Native
    console.log('Updating Task #259: Set up mobile project with Expo/React Native');
    await updateTask(259, {
      status: 'in_review',
      success_rate: 1.0,  // 100% - all tests passed
      updated_at: new Date().toISOString()
    });
    console.log('✅ Task #259 updated to in_review with 100% success rate\n');

    console.log('🎉 Both tasks successfully moved to in_review status!');
    console.log('\nTask Summary:');
    console.log('- Task #258: Figma Design → in_review');
    console.log('- Task #259: Expo Project Setup → in_review (100% success)');
    
  } catch (error) {
    console.error('\n❌ Failed to update tasks:', error.message);
    process.exit(1);
  }
}

main();
