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
// P5-5 Fix: Warn once per isolate when ALLOWED_ORIGIN is not configured in production.
// Gate on APP_ENV=production so local dev (where wildcard CORS is expected) stays quiet.
// To enable: supabase secrets set APP_ENV=production ALLOWED_ORIGIN=https://your-app.com
const _corsOrigin = Deno.env.get('ALLOWED_ORIGIN');
if (!_corsOrigin && Deno.env.get('APP_ENV') === 'production') {
  console.warn('[cors] ALLOWED_ORIGIN env var not set in production — defaulting to wildcard (*). Set it via: supabase secrets set ALLOWED_ORIGIN=https://your-app.com');
}

export function buildCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': _corsOrigin ?? '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-version, x-request-id',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}
