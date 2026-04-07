/**
 * C3 Fix: Shared minimum app version check for edge functions.
 *
 * Reads the `x-app-version` header (sent by the mobile client) and compares it
 * against `MINIMUM_APP_VERSION` (env var or hard-coded fallback). Returns a 426
 * Upgrade Required response when the client is too old, enabling the client to
 * show a ForceUpdateScreen.
 *
 * When the header is absent and `allowMissingHeader` is false (default), the
 * function auto-detects service-role callers by checking the Authorization
 * header and `apikey` header against `SUPABASE_SERVICE_ROLE_KEY`, as well as
 * the `x-bot-auth` header against `INTERNAL_BOT_AUTH_KEY`.  Detected
 * service-role requests are allowed through without a version header; all other
 * requests are treated as `0.0.0`.
 *
 * Usage in an edge function:
 *   import { checkMinimumVersion } from '../_shared/versionCheck.ts';
 *   const versionError = checkMinimumVersion(req, corsHeaders);
 *   if (versionError) return versionError;
 */

/** Env-configurable minimum version. Falls back to '1.0.0', enforcing that minimum when the env var is unset. */
const MINIMUM_APP_VERSION = Deno.env.get('MINIMUM_APP_VERSION') ?? '1.0.0';

// Wired into all edge function entrypoints (after CORS/OPTIONS handling).

/**
 * Compare two semver strings (major.minor.patch). Returns:
 *  -1 if a < b,  0 if a == b,  1 if a > b.
 * Leading 'v' prefixes (e.g. "v1.2.3") are stripped before comparison.
 * Non-numeric or missing segments default to 0.
 */
function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const strip = (v: string) => v.startsWith('v') || v.startsWith('V') ? v.slice(1) : v;
  const parse = (v: string) => strip(v).split('.').map(n => Number(n) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

/**
 * Returns true when the request carries service-role or internal-bot
 * credentials in its headers (Authorization bearer matching the service-role
 * key, apikey header matching the service-role key, or x-bot-auth matching the
 * internal bot key).
 *
 * Note: some edge functions (play-cards, player-pass) also accept a `_bot_auth`
 * field in the JSON body as a tertiary fallback when headers are stripped by
 * internal routing.  The version gate intentionally does NOT inspect the body
 * (it runs before body parsing).  In practice, bot-coordinator always sends
 * both the Authorization and x-bot-auth headers, so the header-based check is
 * sufficient.
 */
function isServiceRoleRequest(req: Request): boolean {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const internalKey = Deno.env.get('INTERNAL_BOT_AUTH_KEY') ?? '';
  const authHeader = req.headers.get('authorization') ?? '';
  const botAuthHdr = req.headers.get('x-bot-auth') ?? '';
  const apikeyHdr = req.headers.get('apikey') ?? '';
  return (
    (serviceKey !== '' && authHeader === `Bearer ${serviceKey}`) ||
    (serviceKey !== '' && apikeyHdr === serviceKey) ||
    (internalKey !== '' && botAuthHdr === internalKey)
  );
}

/**
 * Returns a 426 Response if the client's `x-app-version` header is below
 * the minimum, or `null` if the version is acceptable.
 *
 * When the header is missing:
 *  - `allowMissingHeader = true` → skip enforcement unconditionally (for
 *    cron/internal callers that never carry the header, e.g. cleanup-rooms).
 *  - `allowMissingHeader = false` (default) → auto-detect service-role callers
 *    via `isServiceRoleRequest`; only those are allowed through without the
 *    header.  All other callers are treated as version `0.0.0`.
 */
export function checkMinimumVersion(
  req: Request,
  corsHeaders: Readonly<Record<string, string>>,
  allowMissingHeader = false,
): Response | null {
  const clientVersion = req.headers.get('x-app-version');

  if (!clientVersion) {
    // Unconditional bypass for purely internal callers (cron, triggers)
    if (allowMissingHeader) return null;
    // Auto-detect service-role/bot callers — they don't carry the header
    if (isServiceRoleRequest(req)) return null;
  }

  const effectiveVersion = clientVersion ?? '0.0.0';

  if (compareSemver(effectiveVersion, MINIMUM_APP_VERSION) < 0) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'App update required',
        code: 'UPDATE_REQUIRED',
        minimum_version: MINIMUM_APP_VERSION,
        current_version: effectiveVersion,
      }),
      {
        status: 426,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }

  return null;
}
