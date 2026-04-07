/**
 * Shared HTTP response helpers for edge functions.
 */

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
