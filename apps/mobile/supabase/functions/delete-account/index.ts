// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ==================== MAIN HANDLER ====================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get authenticated user from request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get user from JWT
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    
    if (authError || !user) {
      console.error('❌ [delete-account] Auth error:', authError);
      return new Response(
        JSON.stringify({ success: false, error: 'Not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;

    console.log('🗑️ [delete-account] Request received:', {
      user_id: userId.substring(0, 8),
    });

    // Delete auth user FIRST to prevent inconsistent state
    // If this fails, user data remains intact
    const { error: deleteError } = await supabaseClient.auth.admin.deleteUser(userId);

    if (deleteError) {
      console.error('❌ [delete-account] Failed to delete auth user:', deleteError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to delete account' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Now delete user data in order (respecting foreign key constraints)
    // These operations are safe even if they fail since auth user is already deleted,
    // but we still log and report any cleanup issues to avoid silent data inconsistencies.

    const cleanupErrors: string[] = [];
    
    // 1. Delete from waiting_room
    const { error: waitingRoomError } = await supabaseClient
      .from('waiting_room')
      .delete()
      .eq('user_id', userId);
    if (waitingRoomError) {
      console.error('⚠️ [delete-account] Failed to delete from waiting_room:', {
        user_id: userId.substring(0, 8),
        error: waitingRoomError,
      });
      cleanupErrors.push('waiting_room');
    }

    // 2. Delete from room_players
    const { error: roomPlayersError } = await supabaseClient
      .from('room_players')
      .delete()
      .eq('user_id', userId);
    if (roomPlayersError) {
      console.error('⚠️ [delete-account] Failed to delete from room_players:', {
        user_id: userId.substring(0, 8),
        error: roomPlayersError,
      });
      cleanupErrors.push('room_players');
    }

    // 3. Delete from user_profiles
    const { error: userProfilesError } = await supabaseClient
      .from('user_profiles')
      .delete()
      .eq('id', userId);
    if (userProfilesError) {
      console.error('⚠️ [delete-account] Failed to delete from user_profiles:', {
        user_id: userId.substring(0, 8),
        error: userProfilesError,
      });
      cleanupErrors.push('user_profiles');
    }

    // 4. Delete from user_stats
    const { error: userStatsError } = await supabaseClient
      .from('user_stats')
      .delete()
      .eq('user_id', userId);
    if (userStatsError) {
      console.error('⚠️ [delete-account] Failed to delete from user_stats:', {
        user_id: userId.substring(0, 8),
        error: userStatsError,
      });
      cleanupErrors.push('user_stats');
    }

    console.log('✅ [delete-account] Successfully deleted account');

    const responseBody: Record<string, any> = { success: true };
    if (cleanupErrors.length > 0) {
      responseBody.cleanup_warnings = {
        message: 'Account deleted, but some related data could not be fully cleaned up.',
        failed_tables: cleanupErrors,
      };
      console.warn('⚠️ [delete-account] Cleanup warnings:', cleanupErrors);
      // TODO: Consider implementing a background cleanup job to retry failed deletions
      // These failures are tracked and can be retried manually or via scheduled task
    }

    // Use 207 Multi-Status when there are cleanup warnings to indicate partial success
    const status = cleanupErrors.length > 0 ? 207 : 200;

    return new Response(
      JSON.stringify(responseBody),
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('💥 [delete-account] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
