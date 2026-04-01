#!/usr/bin/env bash
# ─── Sentry Production Setup ──────────────────────────────────────────────────
# Run once to configure alert rules, inbound filters, ownership rules, and
# fingerprinting rules via the Sentry Management API.
#
# Prerequisites:
#   1. Generate a User Auth Token at https://bigtwoapp.sentry.io/settings/auth-tokens/
#      (scopes needed: project:write, project:admin, alerts:write, org:read)
#   2. Export it:  export SENTRY_TOKEN=sntrys_xxxx
#   3. Run:        bash apps/mobile/scripts/setup-sentry-production.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

ORG="bigtwoapp"
PROJECT="big2-mobile"
REGION_HOST="de.sentry.io"  # EU data residency
BASE="https://${REGION_HOST}/api/0"

if [[ -z "${SENTRY_TOKEN:-}" ]]; then
  echo "❌ SENTRY_TOKEN is not set."
  echo "   Generate one at https://bigtwoapp.sentry.io/settings/auth-tokens/"
  exit 1
fi

AUTH="Authorization: Bearer ${SENTRY_TOKEN}"

echo "🔧 Configuring Sentry project: ${ORG}/${PROJECT}"
echo ""

# ── 1. Inbound Filters ────────────────────────────────────────────────────────
echo "1/4  Setting inbound filters (drop localhost + browser extensions)..."
curl -s -X PUT "${BASE}/projects/${ORG}/${PROJECT}/filters/blacklisted_ips/" \
  -H "${AUTH}" -H "Content-Type: application/json" \
  -d '{"active": true}' > /dev/null

curl -s -X PUT "${BASE}/projects/${ORG}/${PROJECT}/filters/browser-extensions/" \
  -H "${AUTH}" -H "Content-Type: application/json" \
  -d '{"active": true}' > /dev/null

# Note: environment-based filtering (e.g. dropping environment:development)
# is handled in the SDK via beforeSend; no server-side environment discard
# rule is configured here.
curl -s -X PUT "${BASE}/projects/${ORG}/${PROJECT}/filters/error-messages/" \
  -H "${AUTH}" -H "Content-Type: application/json" \
  -d '{"active": true, "subfilters": []}' > /dev/null
echo "   ✅ Inbound filters configured"

# ── 2. Ownership Rules ────────────────────────────────────────────────────────
echo "2/4  Setting ownership rules..."
OWNERSHIP_RULES='path:apps/mobile/src/* michaelelalam-glitch
tags.environment:development #ignore'

curl -s -X PUT "${BASE}/projects/${ORG}/${PROJECT}/ownership/" \
  -H "${AUTH}" -H "Content-Type: application/json" \
  -d "{\"raw\": $(echo "${OWNERSHIP_RULES}" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))")}" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('   ✅ Ownership rules set') if 'raw' in d else print('   ⚠️ Unexpected response:', d)"

# ── 3. Fingerprinting Rules ───────────────────────────────────────────────────
echo "3/4  Setting fingerprinting rules..."
FINGERPRINT_RULES='# Group all console.error-wrapped events together (prevents each console.error
# message from creating a separate issue)
stack.abs_path:**/main.jsbundle** logger:console -> console-error-dev

# Group NSInvalidArgumentException SwiftValue crashes (LiveKit/iOS bridge)
# so they never re-open after being resolved
error.type:NSInvalidArgumentException stack.function:*SwiftValue* -> third-party-swift-bridge'

curl -s -X PUT "${BASE}/projects/${ORG}/${PROJECT}/grouping-config/" \
  -H "${AUTH}" -H "Content-Type: application/json" \
  -d "{\"fingerprintingRules\": $(echo "${FINGERPRINT_RULES}" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))")}" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('   ✅ Fingerprinting rules set') if 'fingerprintingRules' in d else print('   ⚠️ Unexpected response:', d)"

# ── 4. Alert Rules ────────────────────────────────────────────────────────────
echo "4/4  Creating alert rules..."

# Alert 1 — Crash-Free Session Rate drops below 98% (Critical)
ALERT1=$(cat <<'EOF'
{
  "name": "Big2 — Crash-Free Session Rate Critical",
  "dataset": "sessions",
  "aggregate": "percentage(sessions_crashed, sessions) AS _crash_rate_alert_aggregate",
  "comparisonType": "count",
  "timeWindow": 60,
  "triggers": [
    {
      "label": "critical",
      "alertThreshold": 98,
      "thresholdType": 1,
      "actions": [
        {"type": "email", "targetType": "user", "targetIdentifier": ""}
      ]
    },
    {
      "label": "warning",
      "alertThreshold": 99.5,
      "thresholdType": 1,
      "actions": []
    }
  ],
  "projects": ["big2-mobile"],
  "environment": "production",
  "resolveThreshold": 99.8,
  "thresholdType": 1,
  "query": "",
  "owner": "team:",
  "monitorType": 0
}
EOF
)

RESULT1=$(curl -s -X POST "${BASE}/organizations/${ORG}/alert-rules/" \
  -H "${AUTH}" -H "Content-Type: application/json" \
  -d "${ALERT1}")
echo "${RESULT1}" | python3 -c "import json,sys; d=json.load(sys.stdin); print('   ✅ Alert 1 created: ' + d.get('name','?')) if 'id' in d else print('   ⚠️ Alert 1:', d.get('detail', str(d))[:120])"

# Alert 2 — Error spike in production (> 50 events / hour)
ALERT2=$(cat <<'EOF'
{
  "name": "Big2 — Production Error Spike",
  "dataset": "events",
  "aggregate": "count()",
  "comparisonType": "count",
  "timeWindow": 60,
  "triggers": [
    {
      "label": "critical",
      "alertThreshold": 50,
      "thresholdType": 0,
      "actions": [
        {"type": "email", "targetType": "user", "targetIdentifier": ""}
      ]
    }
  ],
  "projects": ["big2-mobile"],
  "environment": "production",
  "query": "is:unresolved",
  "owner": "team:",
  "monitorType": 0
}
EOF
)

RESULT2=$(curl -s -X POST "${BASE}/organizations/${ORG}/alert-rules/" \
  -H "${AUTH}" -H "Content-Type: application/json" \
  -d "${ALERT2}")
echo "${RESULT2}" | python3 -c "import json,sys; d=json.load(sys.stdin); print('   ✅ Alert 2 created: ' + d.get('name','?')) if 'id' in d else print('   ⚠️ Alert 2:', d.get('detail', str(d))[:120])"

# Alert 3 — Users experiencing errors (> 5 unique users / hour)
ALERT3=$(cat <<'EOF'
{
  "name": "Big2 — Users Experiencing Errors",
  "dataset": "events",
  "aggregate": "count_unique(user)",
  "comparisonType": "count",
  "timeWindow": 60,
  "triggers": [
    {
      "label": "critical",
      "alertThreshold": 5,
      "thresholdType": 0,
      "actions": [
        {"type": "email", "targetType": "user", "targetIdentifier": ""}
      ]
    }
  ],
  "projects": ["big2-mobile"],
  "environment": "production",
  "query": "is:unresolved",
  "owner": "team:",
  "monitorType": 0
}
EOF
)

RESULT3=$(curl -s -X POST "${BASE}/organizations/${ORG}/alert-rules/" \
  -H "${AUTH}" -H "Content-Type: application/json" \
  -d "${ALERT3}")
echo "${RESULT3}" | python3 -c "import json,sys; d=json.load(sys.stdin); print('   ✅ Alert 3 created: ' + d.get('name','?')) if 'id' in d else print('   ⚠️ Alert 3:', d.get('detail', str(d))[:120])"

echo ""
echo "🎉 Done! Verify at: https://bigtwoapp.sentry.io/settings/projects/big2-mobile/alerts/"
echo ""
echo "── Manual steps still required in the Sentry UI ──────────────────────────"
echo "  Dashboard (can't be created via API in all plans):"
echo "  → https://bigtwoapp.sentry.io/dashboards/new/"
echo "  → Name: 'Big2 Mobile Production'"
echo "  → Add widgets: Session Health, Crash Rates by Release,"
echo "    Top Unhandled Error Types, Users Affected, Error Count by Release"
echo ""
echo "  Performance settings:"
echo "  → https://bigtwoapp.sentry.io/settings/projects/big2-mobile/performance/"
echo "  → Enable: React Native App Start Tracking"
echo "  → Enable: React Native Frame Tracking"
echo "  → These are already in code: tracesSampleRate=0.2, profilesSampleRate=0.1"
