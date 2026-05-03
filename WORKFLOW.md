# Workflow Reference

## Purpose

This file is a human-readable reference for the issue automation workflow.

It is not the source of truth for orchestration logic. The orchestrator is a
deterministic state machine implemented in code. It observes issue status,
materializes context files, runs the assigned AI agent for the current phase,
verifies expected artifacts, records results, and advances status.

The orchestrator is not itself an AI agent.

## Core Model

The orchestrator drives issue state forward.

AI agents are stateless subprocesses. Continuity between phases is maintained by
files written under `.code-workflow/` inside the project working directory.

Example workspace layout:

```text
.code-workflow/
  eng-42-issue.md
  eng-42-plan.md
  eng-42-plan-review.md
  eng-42-implementation.md
  eng-42-code-review.md
  eng-42-completion.md
  eng-42-run-log.json
```

Use stable issue identifiers or slugs for file prefixes. Do not use raw issue
titles as filenames.

## Issue Status Flow

Issues move through this workflow:

```text
Backlog
Todo
Plan - Before Review
Plan - In Review
Plan - Approved
Plan - Disapproved
Coding in Process
Code - Before Review
Code - In Review
Code - Approved
Code - Disapproved
Done
Cancelled
```

The orchestrator must not dispatch work for issues in `Backlog`, `Done`, or
`Cancelled`.

## Dispatch Requirements

Before dispatching any agent, the orchestrator must verify:

- The issue belongs to a project.
- The project has a local working directory.
- The issue is assigned to an AI agent user.
- The issue is not in `Backlog`.
- The issue is not in `Done`.
- The issue is not in `Cancelled`.
- No run is already pending or running for the issue.
- Project concurrency limits allow a new run.

If any requirement fails, the orchestrator must not run an agent.

## State Transitions

### Todo -> Plan - Before Review

The orchestrator:

1. Fetches the issue via API.
2. Writes issue context to `.code-workflow/<slug>-issue.md`.
3. Runs the assigned AI agent as a planning agent.
4. Requires the agent to write `.code-workflow/<slug>-plan.md`.
5. Verifies `<slug>-plan.md` exists and is non-empty.
6. Posts the plan as an issue comment.
7. Moves the issue to `Plan - Before Review`.

Planning agent rules:

- Read `<slug>-issue.md`.
- Inspect relevant code.
- Do not modify source code.
- Write the implementation plan to `<slug>-plan.md`.
- Include affected files, approach, assumptions, risks, and validation strategy.

### Plan - Before Review -> Plan - Approved or Plan - Disapproved

The orchestrator:

1. Reads `<slug>-issue.md` and `<slug>-plan.md`.
2. Runs the assigned AI agent as a plan review agent.
3. Requires the agent to write `<slug>-plan-review.md`.
4. Verifies `<slug>-plan-review.md` exists and contains an approval decision.
5. Posts the review as an issue comment.
6. Moves the issue to `Plan - Approved` or `Plan - Disapproved`.

Plan review agent rules:

- Review the plan for correctness, scope, risk, and validation.
- Do not modify source code.
- Clearly include either `Approved` or `Disapproved`.

### Plan - Approved -> Code - Before Review

The orchestrator:

1. Reads `<slug>-issue.md`, `<slug>-plan.md`, and `<slug>-plan-review.md`.
2. Runs the assigned AI agent as a coding agent.
3. Requires the agent to write `<slug>-implementation.md`.
4. Verifies `<slug>-implementation.md` exists and includes validation results.
5. Posts the implementation summary as an issue comment.
6. Moves the issue to `Code - Before Review`.

Coding agent rules:

- Implement the approved plan.
- Make the smallest correct code change.
- Preserve existing project structure and style.
- Avoid unrelated refactors.
- Run relevant validation.
- Write changed files, validation, and remaining risks to
  `<slug>-implementation.md`.
- Do not create commits unless explicitly instructed.

### Code - Before Review -> Code - Approved or Code - Disapproved

The orchestrator:

1. Reads `<slug>-issue.md`, `<slug>-plan.md`, `<slug>-plan-review.md`, and
   `<slug>-implementation.md`.
2. Runs the assigned AI agent as a code review agent.
3. Requires the agent to write `<slug>-code-review.md`.
4. Verifies `<slug>-code-review.md` exists and contains an approval decision.
5. Posts the review as an issue comment.
6. Moves the issue to `Code - Approved` or `Code - Disapproved`.

Code review agent rules:

- Review concrete defects, regressions, missing tests, and scope violations.
- Verify the implementation matches the approved plan.
- Do not modify source code.
- Clearly include either `Approved` or `Disapproved`.

### Code - Approved -> Done

The orchestrator:

1. Reads all prior artifacts.
2. Writes or requests `<slug>-completion.md`.
3. Posts a final completion summary.
4. Moves the issue to `Done`.

Completion rules:

- Confirm approved plan and approved code review exist.
- Confirm validation evidence is present.
- Do not modify source code.

## Disapproval and Retry Paths

```text
Plan - Disapproved -> Todo
Code - Disapproved -> Coding in Process
Coding in Process -> Code - Before Review
```

Failure rules:

- If an agent exits with an error, record the run as failed.
- If an agent times out, record the run as failed.
- If an expected artifact is missing, do not advance status.
- If validation fails during coding, move to `Coding in Process`.
- Do not retry indefinitely.
- Do not run multiple agents for the same issue at the same time.

## Example Planning Prompt

```text
You are the planning agent for issue ENG-42.

Read:
.code-workflow/eng-42-issue.md

Write the implementation plan to:
.code-workflow/eng-42-plan.md

Rules:
- Do not modify source code.
- Inspect relevant files before writing the plan.
- Include affected files, approach, assumptions, risks, and validation.
- When done, respond with a short summary.
```
