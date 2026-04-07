/**
 * C3 Fix: Shared minimum app version check for edge functions.
 *
 * Reads the `x-app-version` header (sent by the mobile client) and compares it
 * against `MINIMUM_APP_VERSION` (env var or hard-coded fallback). Returns a 426
 * Upgrade Required response when the client is too old, enabling the client to
 * show a ForceUpdateScreen.
 *
 * Usage in an edge function:
 *   import { checkMinimumVersion } from '../_shared/versionCheck.ts';
 *   const versionError = checkMinimumVersion(req, corsHeaders);
 *   if (versionError) return versionError;
 */

/** Env-configurable minimum version. Falls back to '1.0.0' (no enforcement). */
const MINIMUM_APP_VERSION = Deno.env.get('MINIMUM_APP_VERSION') ?? '1.0.0';

/**
 * Compare two semver strings (major.minor.patch). Returns:
 *  -1 if a < b,  0 if a == b,  1 if a > b.
 * Non-numeric or missing segments default to 0.
 */
function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string) => v.split('.').map(n => Number(n) || 0);
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
 * Returns a 426 Response if the client's `x-app-version` header is below
 * the minimum, or `null` if the version is acceptable (or no header present,
 * which is treated as "internal / service-role caller — allow").
 */
export function checkMinimumVersion(
  req: Request,
  corsHeaders: Record<string, string>,
): Response | null {
  const clientVersion = req.headers.get('x-app-version');
  if (!clientVersion) {
    // No version header — likely a service-role call (bot-coordinator, etc.)
    return null;
  }

  if (compareSemver(clientVersion, MINIMUM_APP_VERSION) < 0) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'App update required',
        code: 'UPDATE_REQUIRED',
        minimum_version: MINIMUM_APP_VERSION,
        current_version: clientVersion,
      }),
      {
        status: 426,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }

  return null;
}
