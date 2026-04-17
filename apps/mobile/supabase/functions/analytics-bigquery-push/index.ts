// deno-lint-ignore-file no-explicit-any
/**
 * analytics-bigquery-push — Scheduled Edge Function.
 *
 * Reads unexported rows from public.analytics_raw_events and sends them to
 * Google BigQuery via the `tabledata.insertAll` REST endpoint.
 * Designed to run on a pg_cron schedule every 5 minutes.
 *
 * Required Supabase secrets:
 *   GOOGLE_CLOUD_SA_KEY   — JSON of a GCP Service Account with
 *                            roles/bigquery.dataEditor on the dataset
 *   BIGQUERY_PROJECT_ID   — GCP project ID (e.g. "my-gcp-project")
 *   BIGQUERY_DATASET_ID   — BigQuery dataset ID (e.g. "big_two_analytics")
 *   BIGQUERY_TABLE_ID     — BigQuery table name (default: "analytics_raw_events")
 *   CRON_SECRET           — Shared bearer secret; must match the app.cron_secret
 *                            database setting used by the pg_cron migration
 *
 * BigQuery table schema (run once in BigQuery console):
 *   Create a table with these fields to match AnalyticsRow:
 *     id              STRING    REQUIRED
 *     event_name      STRING    REQUIRED
 *     user_id         STRING    NULLABLE
 *     client_id       STRING    REQUIRED
 *     session_id      INT64     NULLABLE
 *     platform        STRING    NULLABLE
 *     app_version     STRING    NULLABLE
 *     event_params    JSON      REQUIRED
 *     user_properties JSON      REQUIRED
 *     debug_mode      BOOL      REQUIRED
 *     received_at     TIMESTAMP REQUIRED
 *   Partitioning: received_at (DAY)   — cheap time-range queries
 *   Clustering:   event_name, user_id — per-event / per-user analytics
 *
 * Security: requires Authorization: Bearer <CRON_SECRET> header; POST only.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const GOOGLE_CLOUD_SA_KEY_RAW = Deno.env.get('GOOGLE_CLOUD_SA_KEY') ?? '';
const BIGQUERY_PROJECT_ID = Deno.env.get('BIGQUERY_PROJECT_ID') ?? '';
const BIGQUERY_DATASET_ID = Deno.env.get('BIGQUERY_DATASET_ID') ?? 'big_two_analytics';
const BIGQUERY_TABLE_ID = Deno.env.get('BIGQUERY_TABLE_ID') ?? 'analytics_raw_events';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

/** Max rows per BigQuery insertAll request (API limit: 50k rows / 10 MB) */
const BATCH_SIZE = 500;

// ── Google OAuth2 token (service account → access token) ─────────────────────

// Base64url encoding (RFC 7515) — no padding, + → -, / → _.
// Plain btoa() produces standard base64 which causes "invalid_grant" /
// JWT parse errors from Google's token exchange endpoint.
const base64url = (input: string): string =>
  btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

async function getGcpAccessToken(saKeyJson: string): Promise<string> {
  const sa = JSON.parse(saKeyJson);
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
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
  const sigBase64url = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const jwt = `${signingInput}.${sigBase64url}`;

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

// Returns the IDs of rows that BigQuery rejected (partial failure). An empty array means all
// rows were accepted. Throws only on a full HTTP-level failure (the entire batch was rejected).
async function pushToBigQuery(rows: AnalyticsRow[], accessToken: string): Promise<string[]> {
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
        // Send params/properties as native JSON values to match BigQuery JSON columns.
        event_params: r.event_params,
        user_properties: r.user_properties,
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
  if (!result.insertErrors || result.insertErrors.length === 0) {
    return []; // All rows accepted by BigQuery
  }

  // Partial failure: BigQuery accepted some rows but rejected others.
  // Map insertErrors[].index back to the batch to identify the failed row IDs.
  // The successfully-inserted rows must still be confirmed so they are not
  // re-exported on the next run (insertId dedup is best-effort, not guaranteed).
  const failedIndices = new Set<number>(
    result.insertErrors.map((e: any) => e.index as number)
  );
  const failedIds = rows.filter((_, i) => failedIndices.has(i)).map((r) => r.id);
  console.error(
    '[analytics-bigquery-push] insertErrors:',
    JSON.stringify(result.insertErrors.slice(0, 10))
  );
  return failedIds;
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // POST only — invoked by pg_cron via HTTP POST; other methods are rejected
  // to minimise the attack surface on the GCP service account credentials.
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Auth guard — CRON_SECRET bearer token required ────────────────────────
  // Prevents unauthorised callers from triggering BigQuery exports using the
  // service account key stored in GOOGLE_CLOUD_SA_KEY.
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Validate required secrets ──────────────────────────────────────────────
  const missingSecrets: string[] = [];
  if (!SUPABASE_URL) missingSecrets.push('SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) missingSecrets.push('SUPABASE_SERVICE_ROLE_KEY');
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

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const startedAt = Date.now();
  let totalExported = 0;
  // Tracks IDs of rows where export_claimed_at was set but export not yet confirmed.
  // Populated by each batch claim; cleared after successful UPDATE. On any failure
  // the catch block releases the claim (export_claimed_at → NULL) for immediate retry.
  const allClaimedIds = new Set<string>();

  try {
    // Get GCP access token once, reuse for all batches
    const accessToken = await getGcpAccessToken(GOOGLE_CLOUD_SA_KEY_RAW);

    // Process in batches until the queue is empty or the time/batch budget is
    // exhausted. Capping prevents a large backlog from hitting the Edge Function
    // execution limit (~5 min); the next pg_cron tick will continue where this
    // run left off.
    const MAX_BATCHES = 20;
    const TIME_BUDGET_MS = 4 * 60 * 1000; // 4-minute budget — leaves ~1 min for cleanup
    let batchNumber = 0;
    while (true) {
      batchNumber++;

      // Safety: stop before approaching the Edge Function execution time limit
      if (batchNumber > MAX_BATCHES || (Date.now() - startedAt) > TIME_BUDGET_MS) {
        console.log(
          `[analytics-bigquery-push] Stopping early (batch ${batchNumber - 1}/${MAX_BATCHES}, ` +
          `${Date.now() - startedAt}ms elapsed). Next run will continue.`
        );
        break;
      }

      // Atomically claim next batch: FOR UPDATE SKIP LOCKED prevents concurrent
      // invocations from picking up the same rows. Claim state is tracked via
      // export_claimed_at (set to now()); confirmed on successful export or released
      // immediately on failure; stale claims (> 10 min) are auto-recovered.
      const { data: rows, error: fetchErr } = await supabase.rpc(
        'analytics_claim_export_batch',
        { p_limit: BATCH_SIZE }
      );

      if (fetchErr) throw new Error(`Supabase claim error: ${fetchErr.message}`);
      if (!rows || rows.length === 0) break; // All exported

      const batchIds = (rows as AnalyticsRow[]).map((r) => r.id);
      batchIds.forEach((id) => allClaimedIds.add(id));

      console.log(
        `[analytics-bigquery-push] Batch ${batchNumber}: pushing ${rows.length} rows to BigQuery`
      );

      // Push to BigQuery; returns IDs of rows BigQuery rejected (empty = total success).
      // Throws only on a full HTTP-level failure so the catch block can release all claims.
      const failedIds = await pushToBigQuery(rows as AnalyticsRow[], accessToken);
      const successIds =
        failedIds.length === 0
          ? batchIds
          : batchIds.filter((id) => !failedIds.includes(id));

      // Confirm export for successfully-inserted rows using Postgres now() — authoritative,
      // clock-skew-free, consistent with received_at (which also uses a server-side default).
      if (successIds.length > 0) {
        const { error: updateErr } = await supabase.rpc(
          'analytics_confirm_batch_export',
          { p_ids: successIds }
        );
        if (updateErr) {
          // Fatal: throw so the catch block releases remaining claim locks for immediate retry.
          throw new Error(`Failed to mark rows as exported: ${updateErr.message}`);
        }
        // Confirmed exported — remove from the in-flight set
        successIds.forEach((id) => allClaimedIds.delete(id));
        totalExported += successIds.length;
      }

      // Release claim on BigQuery-rejected rows so they are retried on the next run
      // immediately (rather than waiting for the 10-minute stale-claim recovery).
      // supabase-js resolves (not throws) on query errors — check { error } explicitly.
      if (failedIds.length > 0) {
        const { error: releaseErr } = await supabase
          .from('analytics_raw_events')
          .update({ export_claimed_at: null })
          .in('id', failedIds);
        if (releaseErr) {
          console.error(
            '[analytics-bigquery-push] Failed to release claim on rejected rows:',
            releaseErr.message
          );
        }
        failedIds.forEach((id) => allClaimedIds.delete(id));
        console.error(
          `[analytics-bigquery-push] ${failedIds.length} row(s) rejected by BigQuery; claims released for retry`
        );
      }

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
    // Release the claim lock on any rows that were claimed but not yet exported
    // so the next scheduled run can pick them up immediately (instead of waiting
    // for the 10-minute stale-claim recovery window).
    // Release in chunks of BATCH_SIZE to avoid exceeding PostgREST URL/querystring
    // limits when allClaimedIds grows to MAX_BATCHES * BATCH_SIZE (up to 10,000 IDs).
    if (allClaimedIds.size > 0) {
      const ids = [...allClaimedIds];
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const chunk = ids.slice(i, i + BATCH_SIZE);
        const { error: resetErr } = await supabase
          .from('analytics_raw_events')
          .update({ export_claimed_at: null })
          .in('id', chunk);
        if (resetErr) {
          console.error(
            '[analytics-bigquery-push] Failed to release claim lock on rows:',
            resetErr.message
          );
        }
      }
    }
    console.error('[analytics-bigquery-push] Fatal error:', err?.message ?? err);
    return new Response(
      JSON.stringify({ error: err?.message ?? String(err), rows_exported: totalExported }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
