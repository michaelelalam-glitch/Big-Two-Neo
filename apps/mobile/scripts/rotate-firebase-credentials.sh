#!/usr/bin/env bash
# rotate-firebase-credentials.sh
# Purges google-services.json from ALL git history, then force-pushes everything.
#
# BEFORE running this script:
#   1. Go to https://console.cloud.google.com -> APIs & Services -> Credentials
#   2. Find the Android API key for this app, click REGENERATE (or DELETE + create new)
#   3. Go to https://console.firebase.google.com -> Project Settings -> General
#   4. Download the new google-services.json into apps/mobile/
#   5. Confirm the app still builds locally with the new file
#
# PREREQ:  pip3 install git-filter-repo
# RUN FROM: anywhere inside the repo (script anchors itself to repo root)
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "${REPO_ROOT}"

# Capture origin URL before filter-repo removes remotes
if git remote get-url origin > /dev/null 2>&1; then
  remote_url="$(git remote get-url origin)"
else
  while true; do
    read -r -p "Enter remote URL (e.g. git@github.com:org/repo.git): " remote_url
    if [[ "${remote_url}" =~ ^(https://|git@|ssh://) ]]; then break; fi
    echo "Invalid URL — must start with https://, git@, or ssh://"
  done
fi

echo "This rewrites ALL git history. All collaborators must re-clone afterwards."
read -r -p "Continue? [y/N] " yn
case "${yn}" in [Yy]) ;; *) echo "Aborted."; exit 0 ;; esac

echo "Fetching and pruning all remotes to ensure all branches are present..."
git fetch --all --prune --tags

if [[ "$(git rev-parse --is-shallow-repository)" == "true" ]]; then
  echo "Unshallowing repo..."
  git fetch --unshallow --tags --prune
fi

echo "Ensuring every remote branch exists locally before rewriting history..."
while IFS= read -r remote_ref; do
  branch_name="${remote_ref#origin/}"
  [[ "${branch_name}" == "HEAD" ]] && continue
  if git show-ref --verify --quiet "refs/heads/${branch_name}"; then
    continue
  fi
  echo "  Creating local branch: ${branch_name}"
  git branch --track "${branch_name}" "${remote_ref}"
done < <(git for-each-ref --format='%(refname:short)' refs/remotes/origin)

echo "Purging apps/mobile/google-services.json from all history..."
git filter-repo --path apps/mobile/google-services.json --invert-paths --force

echo "Re-adding origin (filter-repo removes remotes)..."
git remote add origin "${remote_url}"

echo "Force-pushing all branches and tags..."
git push origin --force --all
git push origin --force --tags

echo ""
echo "Done. Notify all collaborators to delete their local clone and re-clone."
