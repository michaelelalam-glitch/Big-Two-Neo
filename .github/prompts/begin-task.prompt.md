---
mode: agent
description: Start a new task — sync dev, create branch, and set up a plan before coding
---

# Begin Task Workflow

You are starting a new development task for Big Two Neo. Follow these steps **in order** before writing any code.

## 1. Sync with latest dev

```bash
git checkout dev
git pull origin dev
```

## 2. Create the feature branch

Use the task number and a short slug. Format: `feat/task-{NUMBER}-{short-description}`

```bash
git checkout -b feat/task-{TASK_NUMBER}-{short-description}
```

For bug fixes use `fix/task-{NUMBER}-{description}`, for docs use `docs/task-{NUMBER}-{description}`.

## 3. Create a task plan

Before writing any code, create a `plan.md` in the session workspace that includes:
- **Problem statement** — what needs to be done and why
- **Approach** — the implementation strategy
- **Work plan** — markdown checkboxes for every subtask
- **Out of scope** — what you are NOT doing

Present the plan to the user and wait for confirmation before proceeding.

## 4. Explore the codebase first

Before coding, identify:
- Files that will be affected
- Existing patterns to follow (component structure, naming conventions)
- Tests that currently cover the area
- Any CI/CD constraints (ESLint rules, TypeScript strict mode)

## 5. Implement in small checkpoints

- Work through the plan checklist one item at a time
- Check off items as you complete them
- After each logical chunk, verify nothing is broken: `pnpm run lint && npx tsc --noEmit`

---

**Task number:** $TASK_NUMBER  
**Description:** $TASK_DESCRIPTION
