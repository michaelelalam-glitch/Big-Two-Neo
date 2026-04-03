// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * mark-disconnected edge function
 *
 * Called ONLY when a player explicitly leaves the game (navigates away, tabs out
 * far enough that AppState triggers 'background', etc.).
 *
 * NOT called when the app is merely backgrounded temporarily (e.g. swipe-up, incoming
 * call) — in that case the heartbeat simply stops and process_disconnected_players()
 * on the server detects it after 30 s.
 *
 * Offline rooms are skipped entirely — the DB function guards this.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

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

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);

    if (authError || !user) {
      console.error('❌ [mark-disconnected] Auth error:', authError);
      return new Response(
        JSON.stringify({ success: false, error: 'Not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // player_id is accepted but not used for validation — the RPC keys by auth user_id.
    // We parse the full body so callers do not get 'unexpected token' errors on extra fields.
    const { room_id } = await req.json();

    console.log('🔌 [mark-disconnected]', {
      user_id: user.id.substring(0, 8),
      room_id: typeof room_id === 'string' ? room_id.substring(0, 8) : String(room_id ?? '').substring(0, 8),
    });

    if (!room_id || typeof room_id !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing or invalid room_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate UUID format to return a clear 400 instead of a confusing 500 if
    // the client passes a syntactically invalid value (PostgREST would reject it
    // with "invalid input syntax for type uuid" which we'd propagate as a 500).
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(room_id)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid room_id format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // SECURITY: Validate room membership before calling the RPC.
    // Without this check any authenticated user could trigger a service-role RPC
    // call (and associated DB reads) for any room_id they supply, creating a DoS
    // vector.  The mark_player_disconnected SQL function is restricted to
    // service_role-only execution, but this edge-function gate prevents wasteful
    // round-trips on behalf of non-members.
    // We look for any row (regardless of connection_status) so a player that was
    // already replaced by a bot can still trigger the idempotent no-op path rather
    // than receiving a misleading 403.
    const { data: membershipRow, error: membershipError } = await supabaseClient
      .from('room_players')
      .select('id')
      .eq('room_id', room_id)
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      console.error('❌ [mark-disconnected] Membership check error:', membershipError);
      return new Response(
        JSON.stringify({ success: false, error: 'Membership check failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!membershipRow) {
      // Not a member of this room — return early without calling the RPC.
      // Use 200 (not 403/404) so callers that fire mark-disconnected at app
      // teardown do not surface spurious errors in the client logs.
      console.log(`[mark-disconnected] user ${user.id.substring(0, 8)} not found in room ${room_id.substring(0, 8)} — skipping`);
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use the server-side function which guards offline rooms
    const { error: rpcError } = await supabaseClient.rpc('mark_player_disconnected', {
      p_room_id: room_id,
      p_user_id: user.id,
    });

    if (rpcError) {
      console.error('❌ [mark-disconnected] RPC error:', rpcError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to mark player as disconnected' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ [mark-disconnected] Success');
    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('💥 [mark-disconnected] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
