// deno-lint-ignore-file no-explicit-any
/**
 * cleanup-rooms Edge Function (Task #523)
 *
 * Calls the cleanup_abandoned_rooms() Postgres RPC to:
 *   - Delete empty waiting rooms older than 2 hours
 *   - Delete stuck "starting" rooms older than 1 minute
 *   - Delete completed/cancelled rooms older than 30 days
 *
 * Designed to be invoked via pg_cron (every 6 hours) or manually.
 * No auth required — uses service_role key internally.
 */
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
