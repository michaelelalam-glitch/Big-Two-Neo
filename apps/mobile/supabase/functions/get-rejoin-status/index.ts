// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { checkMinimumVersion } from '../_shared/versionCheck.ts';
// M12: CORS origin controlled by ALLOWED_ORIGIN env var
import { buildCorsHeaders } from '../_shared/cors.ts';

const corsHeaders = buildCorsHeaders();




/**
 * get-rejoin-status edge function
 *
 * Called by the client when the app comes back to the foreground while the
 * player is supposed to be in an active game. Returns one of:
 *
 *   { status: 'connected',       player_index }                 — nothing to do
 *   { status: 'disconnected',    seconds_left, player_index }   — in grace period
 *   { status: 'replaced_by_bot', player_index, bot_username }   — can reclaim
 *   { status: 'room_closed' }                                   — game over, redirect home
 *   { status: 'not_in_room' }                                   — was never here
 */
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

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get user from JWT
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let room_id: string | undefined;
    try {
      const body = await req.json();
      room_id = body?.room_id;
    } catch (parseError) {
      console.error('❌ [get-rejoin-status] Invalid JSON body:', parseError);
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid JSON body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!room_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing room_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // #27 — Validate UUID format (P5-10): consistent with mark-disconnected.
    // Type-check and trim before regex to handle accidental whitespace from clients.
    const roomId = typeof room_id === 'string' ? room_id.trim() : '';
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(roomId)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid room_id format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // P5-4 Fix: Verify the requesting user is actually a member of the room
    // before returning any status. Prevents information disclosure to non-members.
    const { data: membership, error: membershipError } = await supabaseClient
      .from('room_players')
      .select('id')
      .eq('room_id', roomId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (membershipError) {
      console.error('❌ [get-rejoin-status] Membership check error:', membershipError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to verify room membership' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!membership) {
      return new Response(
        JSON.stringify({ success: true, status: 'not_in_room' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: statusResult, error: rpcError } = await supabaseClient
      .rpc('get_rejoin_status', {
        p_room_id: roomId,
        p_user_id: user.id,
      });

    if (rpcError) {
      console.error('❌ [get-rejoin-status] RPC error:', rpcError);
      return new Response(
        JSON.stringify({ success: false, error: rpcError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, ...(statusResult as object) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('💥 [get-rejoin-status] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
