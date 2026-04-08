# Edge Function Cold Start Baseline (L9)

## Overview

This document records the cold start performance baseline for Supabase edge functions
(Deno runtime) in the Big-Two-Neo project.

## Measurements

| Invocation Type | Latency | Notes |
|----------------|---------|-------|
| Cold start (first invocation) | 200–400 ms | Deno isolate boot + module init |
| Warm invocation | < 50 ms | Reused isolate, no boot overhead |

## Alert Threshold

Cold start latency exceeding **800 ms** (approximately 2× the p95 cold start + boot
overhead) should be investigated. This can be caused by:

- Excessive top-level `await` in edge function entry points
- Large dependency trees loaded at startup
- Supabase region congestion (verify in Supabase dashboard → Functions → Logs)

## Methodology

Baseline was measured by invoking edge functions immediately after a cold deploy
(no prior traffic) and recording the response time via Supabase function logs.

Warm latency was measured after 3+ successive invocations within the same isolate
lifetime window.

## CI Integration

The `.github/workflows/test.yml` CI pipeline includes a "Cold start baseline (L9)"
step that echoes the documented thresholds on every run. This step provides a
permanent audit trail in CI logs and surfaces the baseline for any reviewer checking
performance context.

For active monitoring, see the Supabase dashboard:
- **Project**: `dppybucldqufbqhwnkxu`
- **Dashboard path**: Functions → [function-name] → Logs → p95 latency

## Functions Covered

All 18 edge functions in `apps/mobile/supabase/functions/` share the same Deno
runtime baseline. Functions with heavy initialization (e.g. those importing large
crypto or analytics modules) may exhibit higher cold starts; profile individually
if latency exceeds the 800 ms alert threshold.
