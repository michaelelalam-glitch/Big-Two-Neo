// deno-lint-ignore-file no-explicit-any
/**
 * cleanup-rooms Edge Function (Task #523)
 *
 * Calls the cleanup_abandoned_rooms() Postgres RPC to:
 *   - Delete empty waiting rooms older than 2 hours
 *   - Delete stuck "starting" rooms older than 1 minute
 *   - Delete completed/cancelled rooms older than 30 days
 *
 * Invocation:
 *   - Periodic cleanup in this project is handled by pg_cron calling the
 *     cleanup_abandoned_rooms() SQL function directly (no HTTP).
 *   - This Edge Function is intended for manual or external HTTP-triggered
 *     runs (e.g. from an external scheduler or Supabase dashboard).
 *
 * AUTH (HTTP only):
 *   - Requires `Authorization: Bearer <CRON_SECRET>` header.
 *   - Set the CRON_SECRET env variable in the Supabase project secrets.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ==================== MAIN HANDLER ====================

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Restrict to POST only — this endpoint triggers destructive DB work
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, error: 'Method not allowed. Use POST.' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    // ── Auth guard ───────────────────────────────────────────────────────────
    // Require a shared CRON_SECRET so only pg_cron/authorised callers can trigger
    // this destructive cleanup. Any missing or wrong secret returns 401.
    const cronSecret = Deno.env.get('CRON_SECRET');
    if (!cronSecret) {
      // Misconfigured deployment — fail loudly so operators notice
      console.error('❌ [cleanup-rooms] CRON_SECRET env variable is not set');
      return new Response(
        JSON.stringify({ success: false, error: 'Server configuration error: missing CRON_SECRET.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authHeader = req.headers.get('Authorization');
    const providedSecret = authHeader?.replace('Bearer ', '').trim();
    if (!authHeader || providedSecret !== cronSecret) {
      console.warn('⚠️ [cleanup-rooms] Unauthorized request — invalid or missing Authorization header');
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Env var validation ───────────────────────────────────────────────────
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      console.error(
        '❌ [cleanup-rooms] Configuration error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.'
      );
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Server configuration error: missing Supabase environment variables.',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseClient = createClient(supabaseUrl, serviceRoleKey);

    console.log('🧹 [cleanup-rooms] Starting room cleanup...');

    const { data, error } = await supabaseClient.rpc('cleanup_abandoned_rooms');

    if (error) {
      console.error('❌ [cleanup-rooms] RPC error:', error);
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ [cleanup-rooms] Cleanup result:', JSON.stringify(data));

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Room cleanup completed',
        result: data,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('💥 [cleanup-rooms] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
