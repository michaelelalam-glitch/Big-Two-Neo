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
export function buildCorsHeaders(): Record<string, string> {
  const origin = Deno.env.get('ALLOWED_ORIGIN');
  // P5-5 Fix: Warn when ALLOWED_ORIGIN is not configured so the wildcard default is
  // visible in Edge Function logs. Set ALLOWED_ORIGIN in production:
  //   supabase secrets set ALLOWED_ORIGIN=https://your-app-domain.com
  if (!origin) {
    console.warn('[cors] ALLOWED_ORIGIN env var not set — defaulting to wildcard (*). Set it in production.');
  }
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-version, x-request-id',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}
