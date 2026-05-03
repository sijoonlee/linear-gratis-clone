# Issue Orchestrator TODO

## Goal

Complete the issue-driven orchestrator as a deterministic state machine inside
the daemon process.

The orchestrator is not an AI agent. It observes issue changes, checks the
current issue state, materializes `.code-workflow/` files, runs the assigned AI
agent for exactly one phase, verifies the expected artifact, comments back to
the issue, and advances status.

The web server remains the source of truth for application data. The daemon owns
local filesystem access and CLI subprocess execution.

## Current Implementation

Implemented:

- Postgres emits `pg_notify('issue_changed', ...)` for issue inserts/updates.
- `src/instrumentation.ts` listens for `issue_changed`.
- The web server forwards issue changes to `POST /issues/dispatch`.
- `daemon.ts` accepts `POST /issues/dispatch { issueId }`.
- `src/daemon/issue-orchestrator.ts` implements:
  - fetch issue details from `/api/issues/:id`
  - skip unless status type is `todo`
  - require the issue to belong to a project
  - require the project to have `workingDirectory`
  - require the issue assignee to be an AI agent user
  - fallback-fetch `/api/projects/:id` if issue payload lacks working directory
  - write `.code-workflow/<slug>-issue.md`
  - run the assigned agent CLI with its configured model and permission mode
  - require `.code-workflow/<slug>-plan.md`
  - post the plan as an issue comment
  - move the issue to `Plan - Before Review`
- `projects.workingDirectory` is required in schema, initial SQL, API, and UI.

Current implemented transition:

```text
Todo -> Plan - Before Review
```

Do not reimplement this path unless refactoring it into smaller modules.

## Workflow States

Issue statuses:

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

Terminal or non-dispatch states:

- `Backlog`
- `Done`
- `Cancelled`

The orchestrator must not start work for issues in those states.

## Artifact Layout

Use a flat `.code-workflow/` directory under the project working directory:

```text
.code-workflow/
  <slug>-issue.md
  <slug>-plan.md
  <slug>-plan-review.md
  <slug>-implementation.md
  <slug>-code-review.md
  <slug>-completion.md
  <slug>-run-log.json
```

Use stable slugs that include the issue ID prefix. Do not use raw issue titles
alone as filenames.

The artifacts provide continuity because each CLI invocation is stateless.

## Remaining State Transitions

### 1. Plan Review

Implement:

```text
Plan - Before Review -> Plan - In Review
Plan - In Review -> Plan - Approved
Plan - In Review -> Plan - Disapproved
```

Daemon behavior:

1. Fetch issue details.
2. Require issue status `Plan - Before Review`.
3. Require AI agent assignee.
4. Require project working directory.
5. Require existing `<slug>-issue.md`.
6. Require existing `<slug>-plan.md`.
7. Move issue to `Plan - In Review`.
8. Run assigned AI agent as plan-reviewing agent.
9. Require `<slug>-plan-review.md`.
10. Parse clear decision: `Approved` or `Disapproved`.
11. Post review as issue comment.
12. Move issue to `Plan - Approved` or `Plan - Disapproved`.

Plan review prompt rules:

- Read `<slug>-issue.md`.
- Read `<slug>-plan.md`.
- Do not modify source code.
- Review correctness, scope, risk, missing details, and validation plan.
- Write review to `<slug>-plan-review.md`.
- Include a clear first-class decision line:

```text
Decision: Approved
```

or:

```text
Decision: Disapproved
```

### 2. Coding

Implement:

```text
Plan - Approved -> Coding in Process
Coding in Process -> Code - Before Review
```

Daemon behavior:

1. Fetch issue details.
2. Require issue status `Plan - Approved` or `Coding in Process`.
3. Require AI agent assignee.
4. Require project working directory.
5. Require `<slug>-issue.md`.
6. Require `<slug>-plan.md`.
7. Require `<slug>-plan-review.md` with `Decision: Approved`.
8. Move issue to `Coding in Process`.
9. Run assigned AI agent as coding agent.
10. Require `<slug>-implementation.md`.
11. Verify implementation artifact includes changed files and validation.
12. Post implementation summary as issue comment.
13. Move issue to `Code - Before Review`.

Coding prompt rules:

- Read issue, plan, and plan review artifacts.
- Implement only the approved plan.
- Modify source files as needed.
- Avoid unrelated refactors.
- Run relevant validation.
- Write `<slug>-implementation.md`.
- Include changed files, validation results, and remaining risks.
- Do not commit unless explicitly instructed.

### 3. Code Review

Implement:

```text
Code - Before Review -> Code - In Review
Code - In Review -> Code - Approved
Code - In Review -> Code - Disapproved
```

Daemon behavior:

1. Fetch issue details.
2. Require issue status `Code - Before Review`.
3. Require AI agent assignee.
4. Require project working directory.
5. Require issue, plan, plan-review, and implementation artifacts.
6. Move issue to `Code - In Review`.
7. Run assigned AI agent as code-reviewing agent.
8. Require `<slug>-code-review.md`.
9. Parse clear decision: `Approved` or `Disapproved`.
10. Post review as issue comment.
11. Move issue to `Code - Approved` or `Code - Disapproved`.

Code review prompt rules:

- Read all prior artifacts.
- Review actual code changes and validation evidence.
- Prioritize bugs, regressions, missing tests, and scope violations.
- Do not modify source code.
- Write `<slug>-code-review.md`.
- Include a clear decision line.

### 4. Completion

Implement:

```text
Code - Approved -> Done
```

Daemon behavior:

1. Require `<slug>-code-review.md` with `Decision: Approved`.
2. Write `<slug>-completion.md`.
3. Post final completion summary as issue comment.
4. Move issue to `Done`.

Completion can be deterministic at first. It does not need an AI agent.

### 5. Disapproval Retry Paths

Implement after the happy path is stable:

```text
Plan - Disapproved -> Todo
Code - Disapproved -> Coding in Process
```

Recommended behavior:

- Plan disapproval should post the review and move back to `Todo`.
- Code disapproval should post the review and move back to `Coding in Process`.
- The next dispatch should reuse existing artifacts and append or overwrite the
  relevant phase artifact intentionally.

Do not retry indefinitely. Add a retry counter or run log before automatic
multi-pass retries.

## Implementation Tasks

### A. Refactor Daemon Helpers

Current `src/daemon/issue-orchestrator.ts` duplicated some command-building
logic from `daemon.ts`.

Extract shared helpers before adding more phases:

```text
src/daemon/api-client.ts
src/daemon/agent-runner.ts
src/daemon/artifacts.ts
src/daemon/issue-orchestrator.ts
```

Suggested ownership:

- `api-client.ts`: typed web API wrapper.
- `agent-runner.ts`: Claude/Codex command construction and subprocess execution.
- `artifacts.ts`: slug generation, artifact paths, reads, writes, validation.
- `issue-orchestrator.ts`: deterministic status transition logic only.

Keep `daemon.ts` as route wiring and scheduler startup.

### B. Add Run Logging

Add a lightweight run log before implementing retries:

```text
.code-workflow/<slug>-run-log.json
```

Minimum fields:

```text
issueId
slug
phase
status
startedAt
finishedAt
agentUserId
agentCli
agentModel
exitCode
error
artifactsRead
artifactsWritten
fromStatus
toStatus
```

This can start as filesystem-only. A database `issue_runs` table can come later
when UI history is needed.

### C. Add Decision Parsing

Create a strict parser for review artifacts:

```text
Decision: Approved
Decision: Disapproved
```

Rules:

- Case-insensitive match is okay.
- Missing decision means the phase failed and status should not advance.
- Ambiguous decision means the phase failed and status should not advance.
- Log and notify failures.

### D. Add Status Lookup Helpers

Avoid hardcoding status IDs. Continue fetching `/api/statuses?teamId=...`, but
centralize lookup by exact status name:

```text
statusIdFor(teamId, 'Plan - In Review')
statusIdFor(teamId, 'Plan - Approved')
...
```

If a required status is missing, fail loudly and do not run the agent.

### E. Concurrency Guard

Current guard is issue-level only:

```text
activeIssueRuns: Set<issueId>
```

Add project-level guard before coding/review phases:

```text
activeProjectRuns: Map<projectId, Set<issueId>>
```

V1 behavior:

- allow only one active issue run per project
- skip duplicate dispatches for an active issue
- do not persist skipped runs yet

### F. UI Follow-Ups

Project UI:

- Working directory is implemented.
- Add a visible "Orchestration" section later if project-level controls are
  added.

Issue UI:

- Show `.code-workflow` artifact links or summaries when available.
- Show recent orchestrator errors if run-log support is added.
- Make it clear that assigning an AI agent user enables issue automation.

## Current Dispatch Rules

The daemon should dispatch only when all are true:

- Issue has a project.
- Project has `workingDirectory`.
- Issue is assigned to an AI agent user.
- Issue is not `Backlog`, `Done`, or `Cancelled`.
- Issue status matches a supported transition.
- No run is already active for the issue.
- Project concurrency allows it.

The orchestrator should not pick unassigned issues, human-assigned issues, or
backlog issues.

## Open Questions

1. Should plan review and code review use the same assigned AI agent, or should
   review use a separate reviewer agent later?
2. Should coding run directly in `project.workingDirectory`, or should it use
   git worktrees before source edits are allowed?
3. Should `Code - Approved -> Done` require a human approval gate later?
4. Should issue automation create commits, branches, or pull requests in a later
   GitHub-backed project model?
5. Should artifact files be overwritten per phase or versioned per attempt?
