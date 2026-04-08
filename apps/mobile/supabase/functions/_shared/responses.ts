/**
 * Shared HTTP response helpers for edge functions.
 *
 * L4: All error responses use { success: false, error: string, code?: string }.
 * L5: Request IDs are propagated via X-Request-ID header for tracing.
 */

/**
 * L5: Generate or echo back a request ID for tracing.
 * Reads X-Request-ID from the incoming request; generates a UUID if absent.
 * Include in all response headers via `{ ...corsHeaders, 'X-Request-ID': requestId }`.
 */
export function getRequestId(req: Request): string {
  return req.headers.get('x-request-id') ?? crypto.randomUUID();
}

/**
 * L4: Build a standardised error JSON response.
 *
 * @param status     HTTP status code
 * @param error      Human-readable error message
 * @param corsHeaders CORS headers to include
 * @param code       Optional machine-readable error code
 * @param requestId  Optional request ID for tracing (include in header)
 */
export function errorResponse(
  status: number,
  error: string,
  corsHeaders: Record<string, string>,
  code?: string,
  requestId?: string,
): Response {
  const body: Record<string, unknown> = { success: false, error };
  if (code) body.code = code;
  const headers: Record<string, string> = { ...corsHeaders, 'Content-Type': 'application/json' };
  if (requestId) headers['X-Request-ID'] = requestId;
  return new Response(JSON.stringify(body), { status, headers });
}

/** Standardised 409 response for CAS / optimistic-lock failures. */
export function concurrentModificationResponse(
  context: string,
  corsHeaders: Record<string, string>,
  functionName = 'edge-function',
): Response {
  console.warn(`[${functionName}] ⚠️ ${context} concurrent modification detected — state already advanced`);
  return new Response(
    JSON.stringify({
      success: false,
      error: 'Concurrent modification — state already advanced',
      code: 'CONCURRENT_MODIFICATION',
      retryable: true,
    }),
    { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
