// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { checkMinimumVersion } from '../_shared/versionCheck.ts';
// M12: CORS origin controlled by ALLOWED_ORIGIN env var
import { buildCorsHeaders } from '../_shared/cors.ts';
// P5-6 Fix: DB-backed rate limiter to prevent account deletion spam.
import { checkRateLimit } from '../_shared/rateLimiter.ts';

const corsHeaders = buildCorsHeaders();




// ==================== MAIN HANDLER ====================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

    // C3: Enforce minimum app version
    const versionError = checkMinimumVersion(req, corsHeaders);
    if (versionError) return versionError;

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get authenticated user from request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing or invalid authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get user from JWT
    const token = authHeader.slice(7);
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    
    if (authError || !user) {
      console.error('❌ [delete-account] Auth error:', authError);
      return new Response(
        JSON.stringify({ success: false, error: 'Not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;

    // P5-6 Fix: Rate limit account deletion to 3 attempts per 10 minutes per user.
    // This prevents brute-force spam against the account deletion endpoint.
    const rl = await checkRateLimit(supabaseClient, userId, 'delete_account', 3, 600);
    if (!rl.allowed) {
      return new Response(
        JSON.stringify({ success: false, error: 'Too many requests. Please try again later.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }





    // H5 Fix: Delete user data FIRST so that if any cleanup step fails, the auth
    // user still exists and the user can retry account deletion. Previously the
    // auth user was deleted first, making partial cleanup failures unrecoverable
    // (orphaned data with no owning auth user to retry).

    // Delete user data in order (respecting foreign key constraints)
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

    const responseBody: Record<string, any> = { success: true };
    if (cleanupErrors.length > 0) {
      // H5: If any cleanup step failed, do NOT delete the auth user — the user
      // can retry and the data will be cleaned up on the next attempt.
      responseBody.success = false;
      responseBody.error = 'Some data could not be cleaned up. Please retry account deletion.';
      responseBody.cleanup_warnings = {
        message: 'Cleanup partially failed. Auth account preserved for retry.',
        failed_tables: cleanupErrors,
      };
      console.warn('⚠️ [delete-account] Cleanup warnings (auth preserved):', cleanupErrors);
      return new Response(
        JSON.stringify(responseBody),
        { status: 207, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // H5: All cleanup succeeded — now safe to delete the auth user as the final step.
    console.log('✅ [delete-account] Data cleanup succeeded, proceeding to auth deletion');
    const { error: deleteError } = await supabaseClient.auth.admin.deleteUser(userId);

    if (deleteError) {
      console.error('❌ [delete-account] Failed to delete auth user (data already cleaned):', deleteError);
      return new Response(
        JSON.stringify({ success: false, error: 'Data cleaned but failed to delete auth account. Please retry.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify(responseBody),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('💥 [delete-account] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
