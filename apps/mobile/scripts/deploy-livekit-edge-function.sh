#!/usr/bin/env bash
# deploy-livekit-edge-function.sh — Phase 6 (Task #649 / #651)
#
# Deploys the `get-livekit-token` Supabase Edge Function and sets the three
# required LiveKit secrets so the function can mint JWT tokens for the app.
#
# Usage:
#   # One-time: make executable
#   chmod +x apps/mobile/scripts/deploy-livekit-edge-function.sh
#
#   # Then run with your credentials:
#   LIVEKIT_API_KEY="mykey" \
#   LIVEKIT_API_SECRET="mysecret" \
#   LIVEKIT_URL="wss://my-project.livekit.cloud" \
#   ./apps/mobile/scripts/deploy-livekit-edge-function.sh
#
#   # Or supply the project ref explicitly:
#   SUPABASE_PROJECT_REF="abcdefgh" ... ./deploy-livekit-edge-function.sh
#
# Required environment variables (must be exported by the caller before running):
#   The script does NOT auto-source any .env or .env.local file.
#   LIVEKIT_API_KEY     LiveKit project API key
#   LIVEKIT_API_SECRET  LiveKit project API secret (keep out of source control)
#   LIVEKIT_URL         LiveKit WebSocket URL, e.g. wss://my-project.livekit.cloud
#
# Optional:
#   SUPABASE_PROJECT_REF  Supabase project ref (default: value in supabase/.temp/project-ref)
#   SKIP_SECRETS          Set to "1" to skip the secret-set step (e.g. secrets already set)
#   SKIP_VERIFY           Set to "1" to skip the curl smoke-test step
#   VERIFY_AUTH_TOKEN     Raw Supabase access token for the smoke-test (do NOT include the 'Bearer ' prefix)

set -euo pipefail

# ── Helpers ─────────────────────────────────────────────────────────────────
red()   { printf '\033[0;31m%s\033[0m\n' "$*"; }
green() { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow(){ printf '\033[0;33m%s\033[0m\n' "$*"; }
bold()  { printf '\033[1m%s\033[0m\n'   "$*"; }

die() { red "❌  $*"; exit 1; }

# ── Check Supabase CLI ───────────────────────────────────────────────────────
if ! command -v supabase &> /dev/null; then
  die "Supabase CLI not found. Install: https://supabase.com/docs/guides/cli"
fi

# ── Resolve project ref ──────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROJECT_REF_FILE="${MOBILE_DIR}/supabase/.temp/project-ref"

if [[ -z "${SUPABASE_PROJECT_REF:-}" ]]; then
  if [[ -f "${PROJECT_REF_FILE}" ]]; then
    SUPABASE_PROJECT_REF="$(cat "${PROJECT_REF_FILE}" | tr -d '[:space:]')"
  else
    die "SUPABASE_PROJECT_REF is not set and ${PROJECT_REF_FILE} does not exist."
  fi
fi

# Validate the resolved ref is non-empty (guards against an empty/whitespace file).
if [[ -z "${SUPABASE_PROJECT_REF}" ]]; then
  die "SUPABASE_PROJECT_REF is empty — check that ${PROJECT_REF_FILE} contains a valid project ref."
fi

bold "=== LiveKit Edge Function — Phase 6 Deploy ==="
echo ""
echo "  Supabase project : ${SUPABASE_PROJECT_REF}"
echo "  Function          : get-livekit-token"
echo ""

# ── Step 1: Deploy the edge function ────────────────────────────────────────
bold "Step 1/3 — Deploying get-livekit-token..."
cd "${MOBILE_DIR}"
supabase functions deploy get-livekit-token --project-ref "${SUPABASE_PROJECT_REF}"
green "✅  get-livekit-token deployed"
echo ""

# ── Step 2: Set LiveKit secrets ──────────────────────────────────────────────
if [[ "${SKIP_SECRETS:-0}" == "1" ]]; then
  yellow "⏭  Skipping secret-set step (SKIP_SECRETS=1)"
else
  bold "Step 2/3 — Setting LiveKit secrets..."
  # Validate that the caller supplied all three required vars
  missing=()
  [[ -z "${LIVEKIT_API_KEY:-}"    ]] && missing+=("LIVEKIT_API_KEY")
  [[ -z "${LIVEKIT_API_SECRET:-}" ]] && missing+=("LIVEKIT_API_SECRET")
  [[ -z "${LIVEKIT_URL:-}"        ]] && missing+=("LIVEKIT_URL")
  if [[ ${#missing[@]} -gt 0 ]]; then
    die "Missing required env vars: ${missing[*]}"
  fi

  # Write secrets to a temp file so their values are never visible in ps/argv.
  SECRETS_TMPFILE="$(mktemp)"
  # shellcheck disable=SC2064  # intentional: expand vars now, not at trap time
  trap "rm -f '${SECRETS_TMPFILE}'" EXIT
  printf 'LIVEKIT_API_KEY=%s\nLIVEKIT_API_SECRET=%s\nLIVEKIT_URL=%s\n' \
    "${LIVEKIT_API_KEY}" "${LIVEKIT_API_SECRET}" "${LIVEKIT_URL}" \
    > "${SECRETS_TMPFILE}"
  chmod 600 "${SECRETS_TMPFILE}"

  supabase secrets set \
    --env-file "${SECRETS_TMPFILE}" \
    --project-ref "${SUPABASE_PROJECT_REF}"
  rm -f "${SECRETS_TMPFILE}"
  green "✅  Secrets set: LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL"
fi
echo ""

# ── Step 3: Smoke-test via curl ──────────────────────────────────────────────
if [[ "${SKIP_VERIFY:-0}" == "1" ]]; then
  yellow "⏭  Skipping smoke-test (SKIP_VERIFY=1)"
else
  bold "Step 3/3 — Smoke-testing the deployed function..."
  if [[ -z "${VERIFY_AUTH_TOKEN:-}" ]]; then
    yellow "⚠️  VERIFY_AUTH_TOKEN is not set — skipping curl smoke-test."
    yellow "    To test manually, run:"
    yellow "    curl -X POST \\"
    yellow "      https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/get-livekit-token \\"
    yellow "      -H 'Authorization: Bearer <your-supabase-access-token>' \\"
    yellow "      -H 'Content-Type: application/json' \\"
    yellow "      -d '{\"roomId\":\"<valid-uuid>\"}'"
  else
    # Ensure curl is available before attempting the smoke-test.
    if ! command -v curl &>/dev/null; then
      yellow "⚠️  curl not found — skipping smoke-test. Install curl to enable automated verification."
    else
    FUNCTION_URL="https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/get-livekit-token"
    # Use a deliberately invalid UUID so the function validates auth first
    # (a 400 "roomId must be a valid UUID" response means auth passed successfully).
    # Strip any accidental "Bearer " prefix so the header does not become
    # "Bearer Bearer <token>" when a caller passes the full header value.
    RAW_TOKEN="${VERIFY_AUTH_TOKEN#Bearer }"
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
      -X POST "${FUNCTION_URL}" \
      -H "Authorization: Bearer ${RAW_TOKEN}" \
      -H "Content-Type: application/json" \
      -d '{"roomId":"not-a-uuid"}')

    if [[ "${HTTP_STATUS}" == "400" ]]; then
      green "✅  Function reachable — returned 400 (expected for invalid UUID, auth passed)"
    elif [[ "${HTTP_STATUS}" == "401" || "${HTTP_STATUS}" == "403" ]]; then
      die "Smoke-test failed: function returned ${HTTP_STATUS} — check VERIFY_AUTH_TOKEN is a valid Supabase access token"
    elif [[ "${HTTP_STATUS}" == "500" ]]; then
      die "Smoke-test failed: function returned 500 — secrets may not be set correctly (check LIVEKIT_* vars)"
    else
      die "Smoke-test failed: unexpected HTTP status ${HTTP_STATUS}"
    fi
    fi
  fi
fi

echo ""
bold "=== Deploy complete ==="
echo ""
echo "Next steps:"
echo "  1. Open Supabase Dashboard → Edge Functions → get-livekit-token → Logs"
echo "     to verify the function is invoked when the app calls it."
echo "  2. On a real device, tap 'Join Video Chat' in a multiplayer game."
echo "     The app calls supabase.functions.invoke('get-livekit-token', ...) and"
echo "     uses the returned JWT to connect to the LiveKit room."
echo "  3. See docs/chinese-poker/LIVEKIT_PHASES.md Phase 6 for full DoD."
echo ""
