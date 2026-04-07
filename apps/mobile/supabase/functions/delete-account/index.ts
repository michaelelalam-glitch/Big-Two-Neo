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
    // Note: auth.users CASCADE handles most of these, but we delete explicitly for
    // defense-in-depth and tables without FK to auth.users.

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

    // 3. Delete from friendships (both directions in a single atomic operation)
    const { error: friendshipsError } = await supabaseClient
      .from('friendships')
      .delete()
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
    if (friendshipsError) {
      console.error('⚠️ [delete-account] Failed to delete friendships:', {
        user_id: userId.substring(0, 8),
        error: friendshipsError,
      });
      cleanupErrors.push('friendships');
    }

    // 4. Delete from push_tokens
    const { error: pushTokensError } = await supabaseClient
      .from('push_tokens')
      .delete()
      .eq('user_id', userId);
    if (pushTokensError) {
      console.error('⚠️ [delete-account] Failed to delete from push_tokens:', {
        user_id: userId.substring(0, 8),
        error: pushTokensError,
      });
      cleanupErrors.push('push_tokens');
    }

    // 5. Delete from rate_limit_tracking (no FK — must be explicit)
    const { error: rateLimitError } = await supabaseClient
      .from('rate_limit_tracking')
      .delete()
      .eq('user_id', userId);
    if (rateLimitError) {
      console.error('⚠️ [delete-account] Failed to delete from rate_limit_tracking:', {
        user_id: userId.substring(0, 8),
        error: rateLimitError,
      });
      cleanupErrors.push('rate_limit_tracking');
    }

    // 6. Nullify match_participants references (SET NULL for GDPR)
    const { error: matchPartError } = await supabaseClient
      .from('match_participants')
      .update({ user_id: null })
      .eq('user_id', userId);
    if (matchPartError) {
      console.error('⚠️ [delete-account] Failed to nullify match_participants:', {
        user_id: userId.substring(0, 8),
        error: matchPartError,
      });
      cleanupErrors.push('match_participants');
    }

    // 7. Delete from player_stats first (before profiles) to avoid FK RESTRICT failures
    const { error: playerStatsError } = await supabaseClient
      .from('player_stats')
      .delete()
      .eq('user_id', userId);
    if (playerStatsError) {
      console.error('⚠️ [delete-account] Failed to delete from player_stats:', {
        user_id: userId.substring(0, 8),
        error: playerStatsError,
      });
      cleanupErrors.push('player_stats');
    }

    // 8. Delete from profiles (cascade may also cover player_stats as defense-in-depth)
    const { error: profilesError } = await supabaseClient
      .from('profiles')
      .delete()
      .eq('id', userId);
    if (profilesError) {
      console.error('⚠️ [delete-account] Failed to delete from profiles:', {
        user_id: userId.substring(0, 8),
        error: profilesError,
      });
      cleanupErrors.push('profiles');
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
