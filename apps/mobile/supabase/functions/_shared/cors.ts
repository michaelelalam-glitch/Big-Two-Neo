/**
 * M12: Shared CORS configuration for Edge Functions.
 *
 * The allowed origin is controlled by the ALLOWED_ORIGIN environment variable.
 * If unset, defaults to '*' (wildcard) so existing deployment behaviour is
 * preserved while you set the secret on your project:
 *
 *   supabase secrets set ALLOWED_ORIGIN=https://your-app-domain.com
 *
 * For local development the variable is typically left unset so '*' is used.
 */
// P5-5 Fix: Warn once per isolate (at module load time) when ALLOWED_ORIGIN is not set.
// Fires at most once per isolate restart, so log volume is negligible even in dev.
// To silence: supabase secrets set ALLOWED_ORIGIN=https://your-app.com
const _corsOrigin = Deno.env.get('ALLOWED_ORIGIN');
if (!_corsOrigin) {
  console.warn('[cors] ALLOWED_ORIGIN env var not set — defaulting to wildcard CORS (*). Set ALLOWED_ORIGIN via: supabase secrets set ALLOWED_ORIGIN=https://your-app.com');
}

export function buildCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': _corsOrigin ?? '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-version, x-request-id',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}
