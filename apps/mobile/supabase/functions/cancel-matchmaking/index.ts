// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { checkMinimumVersion } from '../_shared/versionCheck.ts';
// M12: CORS origin controlled by ALLOWED_ORIGIN env var
import { buildCorsHeaders } from '../_shared/cors.ts';

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
      console.error('❌ [cancel-matchmaking] Auth error:', authError);
      return new Response(
        JSON.stringify({ success: false, error: 'Not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;

    console.log('🚫 [cancel-matchmaking] Request received:', {
      user_id: userId.substring(0, 8),
    });

    // H8 Fix: Single atomic DELETE instead of UPDATE+DELETE to prevent race
    // condition where a concurrent find-match could see the intermediate
    // 'cancelled' state. Only deletes rows still in 'waiting' status.
    const { data: deleted, error: deleteError } = await supabaseClient
      .from('waiting_room')
      .delete()
      .eq('user_id', userId)
      .eq('status', 'waiting')
      .select('user_id');

    if (deleteError) {
      console.error('❌ [cancel-matchmaking] Failed to delete waiting room entry:', deleteError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to cancel matchmaking' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const wasWaiting = (deleted?.length ?? 0) > 0;
    if (!wasWaiting) {
      // Row was already claimed by find-match (status='processing'/'matched') or
      // already deleted — not an error, just a no-op.
      console.log('ℹ️ [cancel-matchmaking] No waiting entry found (may have been matched already)');
    }

    console.log('✅ [cancel-matchmaking] Successfully cancelled matchmaking');

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('💥 [cancel-matchmaking] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
