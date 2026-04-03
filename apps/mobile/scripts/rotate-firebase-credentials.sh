#!/usr/bin/env bash
# ─── Phase 1: Firebase Credential Rotation & Git History Purge ─────────────
# Tracked in: Task #657 — Phase 1 Security Hardening
# Reference:  docs/PRODUCTION_AUDIT_REPORT.md  (SEC-02)
#
# RUN ORDER (do in this exact order to avoid window of exposure):
#   Step 1  — Rotate/revoke keys in Firebase Console  (manual)
#   Step 2  — Update local google-services.json with new keys  (manual)
#   Step 3  — Purge old file from git history               (this script)
#   Step 4  — Force-push rewritten history                   (this script)
#
# Prerequisites:
#   • git-filter-repo >= 2.38  →  pip3 install git-filter-repo
#   • All team members must re-clone after the force-push
#   • Coordinate with collaborators before running
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

TARGET_FILE="apps/mobile/google-services.json"
REMOTE="origin"

# ── Preflight ───────────────────────────────────────────────────────────────
if ! command -v git-filter-repo &>/dev/null; then
  echo "❌ git-filter-repo is not installed."
  echo "   Install: pip3 install git-filter-repo"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "❌ Working tree is dirty. Commit or stash all changes first."
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Phase 1 — Firebase Credential Rotation & History Purge"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "⚠️  This will REWRITE git history. Collaborators must re-clone."
echo ""
read -r -p "Have you already rotated the Firebase API keys in the Firebase Console? [y/N] " confirm
case "${confirm}" in
  [Yy])
    ;;
  *)
    echo ""
    echo "  Action required:"
    echo "  1. Go to Firebase Console → Project Settings → Service Accounts"
    echo "  2. Regenerate the Android app API key"
    echo "  3. Download the new google-services.json to apps/mobile/"
    echo "  4. Re-run this script"
    exit 1
    ;;
esac

read -r -p "Are you sure you want to rewrite git history? This cannot be undone. [y/N] " confirm2
case "${confirm2}" in
  [Yy])
    ;;
  *)
    echo "Aborted."
    exit 0
    ;;
esac

# ── Capture remote URL before rewriting (filter-repo removes remotes) ────────
REMOTE_URL=$(git remote get-url "${REMOTE}" 2>/dev/null || echo "")
if [[ -z "${REMOTE_URL}" ]]; then
  read -r -p "Enter remote URL (e.g. git@github.com:org/repo.git): " REMOTE_URL
fi
echo "📌 Remote URL captured: ${REMOTE_URL}"

# ── Fetch everything before rewriting ───────────────────────────────────────
echo ""
echo "📥 Fetching all remote refs..."
git fetch --all --prune

# ── Purge the file from ALL history ─────────────────────────────────────────
echo ""
echo "🔥 Purging '${TARGET_FILE}' from all commits..."
git filter-repo \
  --path "${TARGET_FILE}" \
  --invert-paths \
  --force

echo ""
echo "✅ File removed from local history."

# ── Re-add remote (filter-repo removes it) ──────────────────────────────────
echo ""
echo "🔗 Re-adding remote '${REMOTE}'..."
git remote add "${REMOTE}" "${REMOTE_URL}" 2>/dev/null || git remote set-url "${REMOTE}" "${REMOTE_URL}"

# ── Force-push ALL local branches and tags to rewrite all remote refs ────────
# Enumerate dynamically so no branch/tag is missed and credentials can't survive
# on any skipped ref.
echo ""
echo "🚀 Force-pushing ALL rewritten branches and tags to remote..."
echo "   (this ensures no remote ref retains the purged file)"
while IFS= read -r ref; do
  branch="${ref#refs/heads/}"
  echo "  → Pushing branch: ${branch}"
  git push "${REMOTE}" "${branch}" --force-with-lease
done < <(git for-each-ref --format='%(refname)' refs/heads/)

# Push all tags
if git tag | grep -q .; then
  echo ""
  echo "  🏷  Pushing all tags (force)..."
  git push "${REMOTE}" --tags --force
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Git history purge complete"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Next steps:"
echo "  1. Notify ALL collaborators to delete their local clones and re-clone"
echo "  2. Revoke the exposed API key in Firebase Console if not done already"
echo "  3. Verify the new google-services.json works on a dev build"
echo "  4. Check GitHub's secret scanning alerts are cleared"
echo ""
