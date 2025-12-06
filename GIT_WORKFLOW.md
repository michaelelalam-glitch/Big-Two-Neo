# Big Two Neo - Git Workflow & Branching Strategy

**Last Updated:** December 6, 2025  
**Status:** ✅ ACTIVE - All team members must follow this workflow

---

## 🎯 Overview

This project uses **Git Flow** - a scalable branching model designed for production apps. Following this workflow prevents merge conflicts, maintains code quality, and ensures smooth releases.

---

## 📊 Branch Structure

```
main (production-ready releases)
  │
  ├── v1.0.0 (tag)
  ├── v1.1.0 (tag)
  │
dev (integration branch for features)
  │
  ├── feat/task-268-multiplayer-rooms
  ├── feat/task-269-leaderboard
  ├── fix/task-270-auth-bug
  └── docs/task-271-api-docs
```

### **Branch Types**

| Branch | Purpose | Lifetime | Merge To |
|--------|---------|----------|----------|
| `main` | Production-ready code | Permanent | N/A |
| `dev` | Integration & testing | Permanent | `main` |
| `feat/*` | New features | Temporary | `dev` |
| `fix/*` | Bug fixes | Temporary | `dev` |
| `docs/*` | Documentation | Temporary | `dev` |
| `hotfix/*` | Critical prod fixes | Temporary | `main` + `dev` |

---

## 🚀 Workflow Steps

### **1. Starting New Work**

```bash
# Always start from latest dev
git checkout dev
git pull origin dev

# Create feature branch (use task number + description)
git checkout -b feat/task-268-multiplayer-rooms

# Work on your feature...
git add .
git commit -m "feat: Implement multiplayer room creation"

# Push to remote
git push origin feat/task-268-multiplayer-rooms
```

### **2. Creating a Pull Request**

1. **Push your branch** to GitHub
2. **Open PR** targeting `dev` (NOT `main`)
3. **Wait for tests** to pass (CI/CD)
4. **Request review** from team or Copilot
5. **Address comments** and push fixes
6. **Merge** using "Squash and merge" (keeps history clean)
7. **Delete branch** after merge (automatic on GitHub)

### **3. Releasing to Production**

```bash
# Switch to main
git checkout main
git pull origin main

# Merge dev (only after thorough testing on dev)
git merge dev --no-ff -m "Release v1.1.0"

# Create version tag (semantic versioning)
git tag v1.1.0 -m "Release v1.1.0 - Description of changes"

# Push to remote
git push origin main
git push origin v1.1.0
```

### **4. Hotfix for Production Bug**

```bash
# Branch from main (NOT dev)
git checkout main
git pull origin main
git checkout -b hotfix/critical-auth-crash

# Fix the bug...
git add .
git commit -m "fix(critical): Prevent auth crash on logout"

# Push and create PR to main
git push origin hotfix/critical-auth-crash

# After merge to main, also merge to dev
git checkout dev
git pull origin dev
git merge hotfix/critical-auth-crash
git push origin dev
```

---

## 📝 Commit Message Format

Use **Conventional Commits** for clarity and automation:

```
<type>(<scope>): <description>

[optional body]
[optional footer]
```

### **Types**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Code style (formatting, no logic change)
- `refactor`: Code restructuring (no feature/fix)
- `test`: Adding/updating tests
- `chore`: Build, config, dependencies

### **Examples**
```bash
git commit -m "feat(lobby): Add room creation with 6-char codes"
git commit -m "fix(auth): Prevent duplicate username registration"
git commit -m "docs: Update API documentation for room endpoints"
git commit -m "refactor(game): Extract card logic into separate module"
git commit -m "test(multiplayer): Add integration tests for realtime sync"
git commit -m "chore: Update React Native to 0.73.0"
```

---

## 🏷️ Versioning Strategy

We use **Semantic Versioning (SemVer)**: `MAJOR.MINOR.PATCH`

- **MAJOR** (1.x.x): Breaking changes, major features
- **MINOR** (x.1.x): New features, backward-compatible
- **PATCH** (x.x.1): Bug fixes, minor improvements

### **Current Version**
- **v1.0.0** (December 6, 2025)
  - Room robustness & global username uniqueness
  - Mobile lobby system with realtime multiplayer
  - Card interaction UI with gestures

### **Upcoming Versions**
- **v1.1.0**: Planned - Full game loop with bot testing
- **v1.2.0**: Planned - Leaderboard & player stats
- **v2.0.0**: Planned - WebRTC video chat integration

---

## ⚠️ Rules & Best Practices

### **DO**
✅ Always branch from `dev` for features/fixes  
✅ Keep feature branches small (1-3 days of work)  
✅ Write descriptive commit messages  
✅ Pull latest `dev` before creating new branches  
✅ Delete branches after merging  
✅ Use "Squash and merge" for PRs  
✅ Tag releases on `main` with semantic versions  
✅ Test thoroughly on `dev` before merging to `main`  

### **DON'T**
❌ Never push directly to `main`  
❌ Never merge `main` into `dev` (only reverse)  
❌ Don't create branches named `v0.262` (use tags instead)  
❌ Don't keep feature branches alive for weeks  
❌ Don't merge without PR review  
❌ Don't commit `node_modules`, `.env`, or build files  
❌ Don't use `git push --force` on shared branches  

---

## 🔧 Common Commands Cheatsheet

```bash
# Check current branch and status
git status
git branch -a

# Sync with remote
git fetch --prune  # Remove deleted remote branches
git pull origin dev

# View commit history
git log --oneline --graph --all --decorate

# Undo last commit (keep changes)
git reset --soft HEAD~1

# Discard all local changes
git checkout .

# Switch branches (save work first!)
git stash  # Save uncommitted changes
git checkout dev
git stash pop  # Restore changes

# View differences
git diff  # Unstaged changes
git diff --staged  # Staged changes
git diff dev..feat/my-branch  # Compare branches

# Clean up local branches
git branch --merged dev | grep -v "dev\|main" | xargs git branch -d
```

---

## 📊 Branch Protection Rules (GitHub Settings)

**For `main` branch:**
- ✅ Require pull request reviews before merging
- ✅ Require status checks to pass (CI/CD)
- ✅ Require branches to be up to date
- ✅ Do not allow force pushes
- ✅ Do not allow deletions

**For `dev` branch:**
- ✅ Require pull request reviews before merging
- ✅ Require status checks to pass
- ⚠️ Allow force pushes (only for maintainers)

---

## 🐛 Troubleshooting

### **"Your branch is behind origin/dev by X commits"**
```bash
git pull origin dev --rebase
```

### **Merge conflict during PR**
```bash
git checkout feat/my-branch
git pull origin dev  # Fetch latest dev
# Resolve conflicts in files
git add .
git commit -m "chore: Resolve merge conflicts with dev"
git push origin feat/my-branch
```

### **Accidentally committed to wrong branch**
```bash
# If not pushed yet
git reset --soft HEAD~1  # Undo commit, keep changes
git stash
git checkout correct-branch
git stash pop
git add .
git commit -m "Your commit message"
```

### **Need to update PR after review**
```bash
# Make changes...
git add .
git commit -m "fix: Address review comments"
git push origin feat/my-branch  # PR updates automatically
```

---

## 📈 Success Metrics

**Clean Git History Checklist:**
- ✅ Only 2 permanent branches (`main`, `dev`)
- ✅ All feature branches deleted after merge
- ✅ Semantic version tags on `main` only
- ✅ Linear commit history (no merge commits on `dev`)
- ✅ All commits follow conventional format
- ✅ No orphaned or stale branches

---

## 🎓 Learning Resources

- [Git Flow Cheatsheet](https://danielkummer.github.io/git-flow-cheatsheet/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Semantic Versioning](https://semver.org/)
- [GitHub Flow](https://docs.github.com/en/get-started/quickstart/github-flow)

---

## 📞 Questions?

If you're unsure about any workflow step, ask in the team chat or check with the project maintainer before proceeding.

**Remember:** A clean Git history is a happy Git history! 🚀
