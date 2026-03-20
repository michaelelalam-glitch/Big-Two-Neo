---
mode: agent
description: Create a PR targeting dev, ensure CI passes, and request Copilot review
---

# Pull Request Workflow

Create and manage a pull request from the current feature branch into `dev`.

## 1. Ensure branch is pushed and up-to-date

```bash
git push origin HEAD
```

## 2. Check CI is passing

Before creating the PR, verify all three CI gates pass locally:
```bash
cd apps/mobile
pnpm run lint          # ESLint — 0 errors required
npx tsc --noEmit       # TypeScript — 0 errors required  
pnpm run test:unit     # Unit tests — all must pass
```

If anything is failing, fix it before creating the PR. **Do not open a PR with broken CI.**

## 3. Create the PR

- **Base branch:** `dev` (NEVER `main`)
- **Title format:** `feat(task-{NUMBER}): {description}` or `fix(task-{NUMBER}): {description}`
- **Body must include:**
  - What this PR does (1-3 sentences)
  - How to test it
  - Any screenshots or notes for reviewers
  - Link to the task number

Use the GitHub CLI or GitHub UI. Example with CLI:
```bash
gh pr create --base dev --title "feat(task-{NUMBER}): {description}" --body "..."
```

## 4. Request Copilot review

After CI is green, request a Copilot code review on the PR.

## 5. Monitor CI

Check the 3 CI gates on the PR:
- ✅ ESLint
- ✅ TypeScript
- ✅ Unit tests

If any gate is red, investigate the failure, fix it, commit and push. The PR updates automatically.

## 6. After approval

- Use **Squash and merge** (keeps history clean)
- Delete the branch after merge
- Pull latest `dev` locally:
  ```bash
  git checkout dev && git pull origin dev
  ```

---

**Current branch:** run `git branch --show-current` to confirm  
**PR number:** check with `gh pr view --web`
