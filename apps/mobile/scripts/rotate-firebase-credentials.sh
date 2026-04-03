#!/usr/bin/env bash
# rotate-firebase-credentials.sh
# Purges apps/mobile/google-services.json from all git history, then force-pushes everything.
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

# Preflight: require git-filter-repo
if ! command -v git-filter-repo > /dev/null 2>&1; then
  echo "Error: git-filter-repo is not installed."
  echo "Install it with: pip3 install git-filter-repo"
  exit 1
fi

remote_name="origin"

# Capture (or prompt for) the remote URL and ensure the remote exists BEFORE
# fetching — git fetch needs the remote in place.
if git remote get-url "${remote_name}" > /dev/null 2>&1; then
  remote_url="$(git remote get-url "${remote_name}")"
else
  while true; do
    read -r -p "Enter remote URL (e.g. git@github.com:org/repo.git): " remote_url
    if [[ "${remote_url}" =~ ^(https://|git@|ssh://) ]]; then break; fi
    echo "Invalid URL — must start with https://, git@, or ssh://"
  done
  echo "Adding ${remote_name} remote before fetching..."
  git remote add "${remote_name}" "${remote_url}"
fi

# Preflight: require a completely clean working tree before history rewrite.
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "Error: working tree is not clean."
  echo "Commit, stash, or remove all staged, unstaged, and untracked changes before running this script."
  git status --short
  exit 1
fi

echo "This rewrites ALL git history. All collaborators must re-clone afterwards."
read -r -p "Continue? [y/N] " yn
case "${yn}" in [Yy]) ;; *) echo "Aborted."; exit 0 ;; esac

echo "Fetching and pruning ${remote_name} to ensure all branches are present..."
git fetch "${remote_name}" --prune --tags

if [[ "$(git rev-parse --is-shallow-repository)" == "true" ]]; then
  echo "Unshallowing repo..."
  git fetch "${remote_name}" --unshallow --tags --prune
fi

echo "Syncing every local branch to the fetched ${remote_name} refs before rewriting history..."
echo "Detaching HEAD so local branches can be force-updated safely..."
git checkout --detach > /dev/null 2>&1 || git switch --detach > /dev/null 2>&1

while IFS= read -r remote_ref; do
  branch_name="${remote_ref#refs/remotes/${remote_name}/}"
  [[ "${branch_name}" == "HEAD" ]] && continue
  echo "  Updating local branch: ${branch_name} -> ${remote_ref}"
  git branch --force "${branch_name}" "${remote_ref}"
  git branch --set-upstream-to="${remote_name}/${branch_name}" "${branch_name}" > /dev/null 2>&1 || true
done < <(git for-each-ref --format='%(refname)' "refs/remotes/${remote_name}")

echo "Purging apps/mobile/google-services.json from all history..."
git filter-repo --path apps/mobile/google-services.json --invert-paths --force

echo "Re-adding ${remote_name} (filter-repo removes remotes)..."
git remote add "${remote_name}" "${remote_url}"

echo "Force-pushing all branches and tags..."
git push "${remote_name}" --force --all
git push "${remote_name}" --force --tags

echo ""
echo "Done. Notify all collaborators to delete their local clone and re-clone."
