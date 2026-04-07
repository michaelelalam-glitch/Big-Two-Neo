// deno-lint-ignore-file no-explicit-any
import { checkMinimumVersion } from '../_shared/versionCheck.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-version',
};

// ==================== MAIN HANDLER ====================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

    // C3: Enforce minimum app version
    const versionError = checkMinimumVersion(req, corsHeaders);
    if (versionError) return versionError;

  try {
    // Get current server timestamp in milliseconds
    const timestamp = Date.now();

    console.log('⏰ [server-time] Returning timestamp:', timestamp);

    return new Response(
      JSON.stringify({ timestamp }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('💥 [server-time] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
