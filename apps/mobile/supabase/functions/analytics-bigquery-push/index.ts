// deno-lint-ignore-file no-explicit-any
/**
 * analytics-bigquery-push — Scheduled Edge Function.
 *
 * Reads unexported rows from public.analytics_raw_events and streams them to
 * Google BigQuery via the BigQuery Storage Write API (or REST insertAll).
 * Designed to run on a pg_cron schedule every 5 minutes.
 *
 * Required Supabase secrets:
 *   GOOGLE_CLOUD_SA_KEY   — JSON of a GCP Service Account with
 *                            roles/bigquery.dataEditor on the dataset
 *   BIGQUERY_PROJECT_ID   — GCP project ID (e.g. "my-gcp-project")
 *   BIGQUERY_DATASET_ID   — BigQuery dataset ID (e.g. "big_two_analytics")
 *   BIGQUERY_TABLE_ID     — BigQuery table name (default: "analytics_raw_events")
 *
 * BigQuery table schema (run once in BigQuery console):
 *   See docs/chinese-poker/architecture/BIGQUERY_SETUP.md
 *
 * Security: only callable with SUPABASE_SERVICE_ROLE_KEY (authenticated internally
 * by the cron job — no public access needed).
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const GOOGLE_CLOUD_SA_KEY_RAW = Deno.env.get('GOOGLE_CLOUD_SA_KEY') ?? '';
const BIGQUERY_PROJECT_ID = Deno.env.get('BIGQUERY_PROJECT_ID') ?? '';
const BIGQUERY_DATASET_ID = Deno.env.get('BIGQUERY_DATASET_ID') ?? 'big_two_analytics';
const BIGQUERY_TABLE_ID = Deno.env.get('BIGQUERY_TABLE_ID') ?? 'analytics_raw_events';

/** Max rows per BigQuery insertAll request (API limit: 50k rows / 10 MB) */
const BATCH_SIZE = 500;

// ── Google OAuth2 token (service account → access token) ─────────────────────

async function getGcpAccessToken(saKeyJson: string): Promise<string> {
  const sa = JSON.parse(saKeyJson);
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/bigquery.insertdata',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  );
  const signingInput = `${header}.${payload}`;

  // Import the RSA private key
  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`GCP token exchange failed: ${err}`);
  }
  const { access_token } = await tokenRes.json();
  return access_token as string;
}

// ── BigQuery insertAll ────────────────────────────────────────────────────────

interface AnalyticsRow {
  id: string;
  event_name: string;
  user_id: string | null;
  client_id: string;
  session_id: number | null;
  platform: string | null;
  app_version: string | null;
  event_params: Record<string, any>;
  user_properties: Record<string, any>;
  debug_mode: boolean;
  received_at: string;
}

async function pushToBigQuery(rows: AnalyticsRow[], accessToken: string): Promise<void> {
  const endpoint =
    `https://bigquery.googleapis.com/bigquery/v2/projects/${BIGQUERY_PROJECT_ID}` +
    `/datasets/${BIGQUERY_DATASET_ID}/tables/${BIGQUERY_TABLE_ID}/insertAll`;

  const body = {
    // skipInvalidRows: false — fail loudly on schema violations
    skipInvalidRows: false,
    ignoreUnknownValues: false,
    rows: rows.map((r) => ({
      insertId: r.id, // idempotency key — prevents duplicate rows on retry
      json: {
        id: r.id,
        event_name: r.event_name,
        user_id: r.user_id ?? null,
        client_id: r.client_id,
        session_id: r.session_id ?? null,
        platform: r.platform ?? null,
        app_version: r.app_version ?? null,
        // Store params as JSON string for BigQuery JSON type, or flatten if using STRUCT.
        // Using STRING column typed as JSON for maximum flexibility without a rigid schema.
        event_params: JSON.stringify(r.event_params),
        user_properties: JSON.stringify(r.user_properties),
        debug_mode: r.debug_mode,
        received_at: r.received_at, // ISO-8601 UTC
      },
    })),
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`BigQuery insertAll HTTP ${res.status}: ${text}`);
  }

  const result = await res.json();
  if (result.insertErrors && result.insertErrors.length > 0) {
    // Log all insert errors but don't throw — we still mark the successfully
    // inserted rows (identified by index) so they aren't retried next run.
    console.error(
      '[analytics-bigquery-push] insertErrors:',
      JSON.stringify(result.insertErrors.slice(0, 10))
    );
    throw new Error(
      `BigQuery insertAll partial failure: ${result.insertErrors.length} row(s) rejected`
    );
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Only accept POST (pg_cron HTTP call) or internal invocations
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Validate required secrets ──────────────────────────────────────────────
  const missingSecrets: string[] = [];
  if (!GOOGLE_CLOUD_SA_KEY_RAW) missingSecrets.push('GOOGLE_CLOUD_SA_KEY');
  if (!BIGQUERY_PROJECT_ID) missingSecrets.push('BIGQUERY_PROJECT_ID');
  if (missingSecrets.length > 0) {
    const msg = `Missing secrets: ${missingSecrets.join(', ')}. Set them with: supabase secrets set ${missingSecrets.map((s) => `${s}=...`).join(' ')}`;
    console.error('[analytics-bigquery-push]', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const startedAt = Date.now();
  let totalExported = 0;

  try {
    // Get GCP access token once, reuse for all batches
    const accessToken = await getGcpAccessToken(GOOGLE_CLOUD_SA_KEY_RAW);

    // Process in batches until no pending rows remain
    let batchNumber = 0;
    while (true) {
      batchNumber++;

      // Fetch next batch of unexported rows (oldest-first for ordered delivery)
      const { data: rows, error: fetchErr } = await supabase
        .from('analytics_raw_events')
        .select(
          'id, event_name, user_id, client_id, session_id, platform, app_version, event_params, user_properties, debug_mode, received_at'
        )
        .is('exported_to_bigquery_at', null)
        .order('received_at', { ascending: true })
        .limit(BATCH_SIZE);

      if (fetchErr) throw new Error(`Supabase fetch error: ${fetchErr.message}`);
      if (!rows || rows.length === 0) break; // All exported

      console.log(
        `[analytics-bigquery-push] Batch ${batchNumber}: pushing ${rows.length} rows to BigQuery`
      );

      // Push to BigQuery (throws on failure — prevents marking row as exported)
      await pushToBigQuery(rows as AnalyticsRow[], accessToken);

      // Mark rows as exported
      const exportedIds = rows.map((r) => r.id);
      const { error: updateErr } = await supabase
        .from('analytics_raw_events')
        .update({ exported_to_bigquery_at: new Date().toISOString() })
        .in('id', exportedIds);

      if (updateErr) {
        // Non-fatal: BigQuery already has the data. Log and continue — the
        // next run will attempt to export these rows again (insertId prevents
        // duplicates in BigQuery via best-effort deduplication).
        console.warn(
          '[analytics-bigquery-push] Failed to mark rows as exported:',
          updateErr.message
        );
      }

      totalExported += rows.length;

      // If fewer rows than batch size, we've exhausted the queue
      if (rows.length < BATCH_SIZE) break;
    }

    const duration = Date.now() - startedAt;
    console.log(
      `[analytics-bigquery-push] Done: ${totalExported} rows exported in ${duration}ms (${batchNumber} batch(es))`
    );

    return new Response(
      JSON.stringify({
        ok: true,
        rows_exported: totalExported,
        batches: batchNumber,
        duration_ms: duration,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[analytics-bigquery-push] Fatal error:', err?.message ?? err);
    return new Response(
      JSON.stringify({ error: err?.message ?? String(err), rows_exported: totalExported }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
