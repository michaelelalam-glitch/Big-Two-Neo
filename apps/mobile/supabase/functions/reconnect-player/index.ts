// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { checkMinimumVersion } from '../_shared/versionCheck.ts';
import { checkRateLimit, rateLimitResponse } from '../_shared/rateLimiter.ts';
// M12: CORS origin controlled by ALLOWED_ORIGIN env var
import { buildCorsHeaders } from '../_shared/cors.ts';

const corsHeaders = buildCorsHeaders();




/**
 * reconnect-player edge function
 *
 * Handles two scenarios:
 *   1. Simple reconnect  – player was disconnected but bot has NOT yet replaced them.
 *      Action: restore connection_status → 'connected', clear disconnected_at.
 *
 *   2. Reclaim-from-bot – bot replaced the player (connection_status = 'replaced_by_bot'
 *      OR human_user_id = auth.uid()).
 *      Action: restore the seat fully (user_id, username, is_bot = false, etc.)




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

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);

    if (authError || !user) {
      console.error('❌ [reconnect-player] Auth error:', authError);
      return new Response(
        JSON.stringify({ success: false, error: 'Not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // M2: Rate limit reconnect attempts — max 5 per 60 seconds per user
    const rl = await checkRateLimit(supabaseClient, user.id, 'reconnect_player', 5, 60);
    if (!rl.allowed) {
      console.warn('⚠️ [reconnect-player] Rate limit exceeded for user:', user.id.substring(0, 8));
      return rateLimitResponse(rl.retryAfterMs, corsHeaders);
    }

    const body = await req.json();
    const { room_id } = body;

    if (!room_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing room_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('🔄 [reconnect-player] user:', user.id.substring(0, 8), 'room:', room_id.substring(0, 8));

    // Delegate entirely to the server-side RPC which handles both reconnect paths
    const { data: rpcResult, error: rpcError } = await supabaseClient
      .rpc('reconnect_player', {
        p_room_id:  room_id,
        p_user_id:  user.id,
      });

    if (rpcError) {
      console.error('❌ [reconnect-player] RPC error:', rpcError);
      return new Response(
        JSON.stringify({ success: false, error: rpcError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const result = rpcResult as {
      success: boolean;
      was_replaced?: boolean;
      room_closed?: boolean;
      player_index?: number;
      username?: string;
      message?: string;
      error?: string;
    };

    if (!result.success) {
      if (result.room_closed) {
        return new Response(
          JSON.stringify({ success: false, room_closed: true, message: result.message }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ success: false, error: result.error || result.message }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ [reconnect-player] Success', {
      was_bot:      result.was_replaced,
      player_index: result.player_index,
    });

    // Broadcast player_reconnected so all other clients know a human reclaimed
    // this seat and can stop waiting for a "bot" to make a move.
    // This is fire-and-forget — we do not block the response on it.
    // IMPORTANT: channel name must be `room:${room_id}` (UUID) to match the
    // client's Realtime subscription in useRealtime.ts joinChannel().
    // Use subscribe→send→removeChannel pattern: supabase-js Realtime requires
    // a SUBSCRIBED channel before send() is reliable; calling send() on an
    // unsubscribed channel can silently drop the message (especially on cold
    // starts / flaky connections).
    const broadcastPromise = (async () => {
      try {
        const broadcastPayload = {
          player_index: result.player_index,
          username:     result.username,
          was_replaced: result.was_replaced ?? false,
        };
        await new Promise<void>((resolve) => {
          const broadcastChannel = supabaseClient.channel(`room:${room_id}`);
          let settled = false;
          const finish = (): void => {
            if (!settled) {
              settled = true;
              supabaseClient.removeChannel(broadcastChannel).catch(() => {});
              resolve();
            }
          };
          const safetyTimeout = setTimeout(finish, 5000);
          broadcastChannel.subscribe((status: string) => {
            // Guard: if the safety timeout already fired and settled the
            // Promise, ignore any late SUBSCRIBED / status callbacks.
            if (settled) return;
            if (status === 'SUBSCRIBED') {
              broadcastChannel
                .send({ type: 'broadcast', event: 'player_reconnected', payload: broadcastPayload })
                .then((sendResult: any) => {
                  // supabase-js Realtime send() resolves (not rejects) on
                  // delivery failures; inspect the resolved value for errors.
                  if (sendResult?.error) {
                    console.warn(`[reconnect-player] Reconnect broadcast delivery failure (non-critical):`, sendResult.error);
                  } else {
                    console.log(`📡 [reconnect-player] Broadcast player_reconnected for room ${room_id} (index ${result.player_index})`);
                  }
                  clearTimeout(safetyTimeout);
                  finish();
                })
                .catch((e: unknown) => {
                  console.warn('[reconnect-player] Broadcast send error (non-critical):', e);
                  clearTimeout(safetyTimeout);
                  finish();
                });
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              clearTimeout(safetyTimeout);
              finish();
            }
          });
        });
      } catch (bcastErr: any) {
        // Non-fatal — clients will also detect the change via postgres_changes
        console.warn('[reconnect-player] Broadcast error (non-critical):', bcastErr?.message);
      }
    })();
    // Register with EdgeRuntime.waitUntil so Deno Deploy keeps the function alive
    // to complete the subscribe→send flow even after the HTTP response returns.
    try { (globalThis as any).EdgeRuntime?.waitUntil(broadcastPromise); } catch (_) {}

    return new Response(
      JSON.stringify({
        success:        true,
        was_bot:        result.was_replaced ?? false,
        username:       result.username,
        player_index:   result.player_index,
        message:        result.message,
        // Legacy field kept for compatibility with useConnectionManager
        result: {
          is_spectator: false,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('💥 [reconnect-player] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
