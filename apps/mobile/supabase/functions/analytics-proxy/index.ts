// deno-lint-ignore-file no-explicit-any
/**
 * analytics-proxy — Server-side proxy for GA4 Measurement Protocol.
 *
 * Moves the GA4 API_SECRET off the client binary and into Supabase secrets.
 * The client sends events to this Edge Function instead of directly to GA4.
 *
 * Supabase secret required:
 *   supabase secrets set GA4_API_SECRET=your_api_secret_here
 *   supabase secrets set GA4_MEASUREMENT_ID=G-XXXXXXXXXX
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GA4_API_SECRET = Deno.env.get('GA4_API_SECRET') ?? '';
const GA4_MEASUREMENT_ID = Deno.env.get('GA4_MEASUREMENT_ID') ?? '';
const MP_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  if (!GA4_API_SECRET || !GA4_MEASUREMENT_ID) {
    console.error('[analytics-proxy] GA4_API_SECRET or GA4_MEASUREMENT_ID not configured');
    return new Response(
      JSON.stringify({ error: 'Analytics not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  try {
    const body = await req.json();

    // Basic validation: must have client_id and events array
    if (!body.client_id || !Array.isArray(body.events) || body.events.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid payload: client_id and events[] required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Cap events per request to prevent abuse
    if (body.events.length > 25) {
      return new Response(
        JSON.stringify({ error: 'Too many events (max 25 per request)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Enforce GA4 100-char string param limit server-side
    for (const event of body.events) {
      if (event.params && typeof event.params === 'object') {
        for (const [key, value] of Object.entries(event.params)) {
          if (typeof value === 'string' && value.length > 100) {
            event.params[key] = (value as string).substring(0, 100);
          }
        }
      }
    }

    const url = `${MP_ENDPOINT}?measurement_id=${encodeURIComponent(GA4_MEASUREMENT_ID)}&api_secret=${encodeURIComponent(GA4_API_SECRET)}`;

    const ga4Response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    return new Response(
      JSON.stringify({ status: ga4Response.status }),
      {
        status: ga4Response.ok ? 200 : 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error: any) {
    console.error('[analytics-proxy] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
