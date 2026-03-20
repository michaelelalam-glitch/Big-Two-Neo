---
mode: agent
description: Investigate failing CI checks on a PR and fix them until all 3 gates are green
---

# Debug CI Failures Workflow

The CI pipeline has 3 gates: **ESLint**, **TypeScript**, and **Unit Tests**. All must be green before merging.

## 1. Identify which gate is failing

Check the PR status or run locally:
```bash
cd apps/mobile

# Gate 1: ESLint
pnpm run lint

# Gate 2: TypeScript
npx tsc --noEmit

# Gate 3: Unit tests
pnpm run test:unit --passWithNoTests
```

Note the exact error output for each failing gate.

## 2. Fix ESLint failures

- Read each error — file path, line, rule name
- Fix the code (do NOT just add `// eslint-disable` comments unless genuinely necessary)
- Rerun `pnpm run lint` to confirm 0 errors

## 3. Fix TypeScript failures

- Read each type error — file, line, error code (e.g. `TS2345`)
- Fix the type — add proper types, don't use `any` as a shortcut unless it's a last resort
- Rerun `npx tsc --noEmit` to confirm 0 errors

## 4. Fix unit test failures

For each failing test:
- Read the error and stack trace
- Determine if the **test is wrong** (outdated mock/assertion) or if the **code broke**
- Fix the root cause — do NOT delete or skip tests to make CI pass
- Rerun `pnpm run test:unit --passWithNoTests` to confirm all pass

## 5. Check for e2e test failures (if applicable)

If the CI run also includes integration/e2e tests:
- Look at the GitHub Actions log for the exact failure
- Check if it's a Supabase secret issue (`EXPO_PUBLIC_SUPABASE_URL` etc.) — integration tests are skipped if secrets are absent
- If it's a genuine test failure, trace the failing test back to the feature code

## 6. Commit fixes and push

```bash
git add .
git commit -m "fix(ci): resolve {ESLint/TypeScript/test} failures

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push origin HEAD
```

Then verify CI turns green on the new commit.

---

**PR or branch:** $BRANCH_NAME  
**Failing CI run URL:** $CI_RUN_URL
