---
mode: agent
description: Analyse a problem and produce a structured implementation plan before writing any code
---

# Create Task Plan Workflow

Before implementing anything, thoroughly understand the problem and produce a written plan.

## 1. Understand the problem

Ask clarifying questions if any of these are unclear:
- What is the user-facing goal? (What should work after this task?)
- What is explicitly **out of scope**?
- Are there design decisions to make? (If so, ask the user to choose.)
- Are there dependencies on other tasks or PRs?

## 2. Explore the codebase

Use grep/glob/view to find:
- Existing code in the area being changed
- Patterns already established (naming, folder structure, component patterns)
- Tests that cover the area
- Any TODOs or known issues nearby

## 3. Write the plan

Create a `plan.md` in the session workspace (not in the repo). It must include:

```markdown
# Task {NUMBER}: {Title}

## Problem
{What needs to be done and why — 2-4 sentences}

## Approach
{Implementation strategy — how you'll solve it}

## Work Plan
- [ ] Explore affected files and understand current state
- [ ] {Subtask 1}
- [ ] {Subtask 2}
- [ ] {Subtask 3}
- [ ] Run lint + typecheck + tests locally
- [ ] Commit and push
- [ ] Open PR targeting develop
- [ ] Request Copilot review

## Out of Scope
- {Thing you are NOT doing}

## Notes / Risks
- {Any edge cases, performance concerns, or gotchas}
```

## 4. Present the plan and wait

Show the plan to the user. **Do not start implementing until the user says to proceed.**

The user may edit the plan, add constraints, or redirect the approach. Incorporate their feedback before starting.

## 5. Execute the plan

Once approved:
- Work through checkboxes one at a time
- Check them off as you complete each item
- If you discover something unexpected, pause and update the plan

---

**Task number:** $TASK_NUMBER  
**Task description:** $TASK_DESCRIPTION
