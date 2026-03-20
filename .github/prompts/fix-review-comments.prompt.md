---
mode: agent
description: Read all review comments on the PR, fix every one, then push and re-request review
---

# Fix Review Comments Workflow

Address all outstanding review comments on the current PR, then push and request a fresh review.

## 1. Fetch all review comments

Get every unresolved comment from the PR. Note the file, line number, and the concern raised.

Use GitHub CLI:
```bash
gh pr view --comments
```
Or look up the PR number and use the GitHub API to list review threads.

## 2. Triage comments

For each comment, categorise:
- 🔴 **Must fix** — bug, security issue, logic error
- 🟡 **Should fix** — performance, clarity, best practice
- 🟢 **Consider** — style preference, optional improvement

Fix ALL 🔴 and 🟡 items. Use your judgement on 🟢.

## 3. Fix each comment

Work through comments one by one:
- Make the change in the relevant file
- If the comment is unclear, make a reasonable fix and note it in the commit body
- Do NOT make unrelated changes in the same commit

## 4. Run CI checks locally

After all fixes:
```bash
cd apps/mobile
pnpm run lint
npx tsc --noEmit
pnpm run test:unit
```

All three must pass before committing.

## 5. Commit the fixes

```bash
git add .
git commit -m "fix: address review comments on PR #{PR_NUMBER}

- {brief note on what was fixed}
- {brief note on what was fixed}

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push origin HEAD
```

## 6. Re-request Copilot review

After pushing, request a new Copilot review so the reviewer can verify fixes.

## 7. Confirm CI is green

Wait for all CI checks to pass on the new commit. If any fail, repeat from step 4.

---

**PR number:** $PR_NUMBER  
**Commit with review comments:** $COMMIT_SHA
