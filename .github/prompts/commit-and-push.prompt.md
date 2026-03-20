---
mode: agent
description: Stage, commit with conventional commits, and push to the current PR branch
---

# Commit & Push Workflow

Stage and commit all current changes, then push to the remote branch.

## Steps

### 1. Review what changed
```bash
git --no-pager status
git --no-pager diff --stat
```

### 2. Run pre-commit checks
```bash
cd apps/mobile && pnpm run lint && npx tsc --noEmit
```
Fix any ESLint or TypeScript errors before committing.

### 3. Stage changes
```bash
git add .
```
Never stage: `node_modules/`, `.env*`, build output (`dist/`, `.expo/`), or secrets.

### 4. Write the commit message

Use **Conventional Commits** format:
```
<type>(<scope>): <short description>

[optional body — what changed and why]

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`  
**Scope:** the area of the app (e.g. `lobby`, `auth`, `game`, `ci`)

**Examples:**
```
feat(lobby): add room creation with 6-char invite codes
fix(auth): prevent duplicate username on registration
refactor(game): extract card validation into pure function
test(multiplayer): add integration tests for realtime sync
chore(ci): remove || true from test steps
```

### 5. Commit & push
```bash
git commit -m "<your message>"
git push origin HEAD
```

If it's the first push on this branch:
```bash
git push -u origin HEAD
```

### 6. Confirm push succeeded
```bash
git --no-pager log --oneline -5
```
