// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { buildCorsHeaders } from '../_shared/cors.ts';
import { checkMinimumVersion } from '../_shared/versionCheck.ts';
import { errorResponse, getRequestId } from '../_shared/responses.ts';

// ==================== MAIN HANDLER ====================

Deno.serve(async (req) => {
  // M12: CORS origin controlled by ALLOWED_ORIGIN env var
  const corsHeaders = buildCorsHeaders();

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // L5: Propagate request ID for tracing
  const requestId = getRequestId(req);

  // C3: Enforce minimum app version
  const versionError = checkMinimumVersion(req, corsHeaders);
  if (versionError) return versionError;

  // L3: Require authenticated caller — server-time must not be publicly accessible
  const authHeader = req.headers.get('authorization') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const anonClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await anonClient.auth.getUser();
  if (authError || !user) {
    return errorResponse(401, 'Unauthorized', corsHeaders, 'UNAUTHORIZED', requestId);
  }

  try {
    // Get current server timestamp in milliseconds
    const timestamp = Date.now();

    console.log(`⏰ [server-time] reqId=${requestId} Returning timestamp:`, timestamp);

    return new Response(
      JSON.stringify({ timestamp }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Request-ID': requestId } }
    );
  } catch (error: any) {
    console.error(`💥 [server-time] reqId=${requestId} Error:`, error);
    return errorResponse(500, error.message || 'Unknown error', corsHeaders, 'INTERNAL_ERROR', requestId);
  }
});
