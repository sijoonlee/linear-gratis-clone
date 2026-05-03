# Symphony Integration — Issue-Driven Agent Dispatch

## Goal

Extend the daemon to support issue-driven agent dispatch alongside the existing
schedule-based execution. The daemon becomes a two-mode execution engine:

- **Schedule mode** (existing): cron jobs trigger agent runs on a time basis
- **Issue mode** (new): issue state/label changes trigger autonomous agent runs

The web server owns all data. The daemon remains a pure HTTP execution server.

---

## Draft Plan

### 1. Trigger — pg_notify on issue changes

Add a Postgres trigger on the `issues` table (similar to `schedule_changed_trigger`).
When an issue becomes eligible, `pg_notify('issue_eligible', { id, teamId })`.
`instrumentation.ts` picks this up and forwards to `POST daemon/issues/dispatch`.

The daemon responds 202 and runs the agent asynchronously.

### 2. Eligibility filter

An issue is eligible when it matches a workflow's filter criteria.
The daemon checks eligibility by calling `GET /api/issues/:id` and comparing
against the workflow config. Non-matching issues are silently ignored.

Open questions:
- What fields define eligibility? (status type, label, assignee, team?)
- Who evaluates eligibility — daemon or web server?

### 3. Workflow config

A `workflows` table defines how issues are handled:

```
workflows
  id          uuid PK
  teamId      uuid FK → teams
  name        text
  prompt      text        -- template, can reference {{issue.title}}, {{issue.description}}
  filterLabel text        -- e.g. "agent" label triggers dispatch
  filterStatus text       -- e.g. status type "unstarted"
  workingDirectory text
  agentCli    text
  model       text
  permissionMode text
  enabled     boolean
  createdAt   timestamp
  updatedAt   timestamp
```

This mirrors the `schedules` table structure so the daemon can reuse the same
execution logic (`runTask`-equivalent).

### 4. Agent run lifecycle

```
issue becomes eligible
  → pg_notify issue_eligible
  → instrumentation.ts → POST daemon/issues/dispatch { issueId }
  → daemon fetches workflow for the issue's team
  → daemon builds prompt (interpolating issue fields)
  → daemon calls POST /api/issue-runs (creates run record, status=running)
  → execFile claude/codex
  → daemon calls PATCH /api/issue-runs/:id (status=completed/failed, output)
  → daemon posts output as comment on the issue (POST /api/issues/:id/comments)
  → daemon optionally updates issue status (PATCH /api/issues/:id)
```

### 5. Issue run record

A new `issue_runs` table to track agent execution history per issue
(analogous to `cron_tasks` for schedules):

```
issue_runs
  id           uuid PK
  issueId      uuid FK → issues
  workflowId   uuid FK → workflows
  status       text   -- pending | running | completed | failed
  output       text
  exitCode     integer
  startedAt    timestamp
  finishedAt   timestamp
  createdAt    timestamp
```

### 6. Per-issue workspace (optional)

Symphony isolates each issue in its own directory. For this project, start simple:
a shared `workingDirectory` per workflow. Per-issue subdirectories can be added later.

### 7. Concurrency

Limit parallel agent runs per workflow (e.g. `maxConcurrent` field on `workflows`).
Daemon tracks active runs in memory, queues or skips if limit is reached.

### 8. Daemon HTTP endpoints (new)

| Method | Path | Body | What it does |
|--------|------|------|--------------|
| POST | /issues/dispatch | `{ issueId }` | evaluate eligibility, run agent |

---

## Open Questions

1. **Eligibility**: Should eligibility be label-based (`agent` label), status-based
   (e.g. `unstarted` type), or both? Should the filter live on the workflow or
   be hardcoded?

2. **Workflow config location**: New `workflows` table (flexible, per-team) vs
   extending `schedules` with a `trigger` field (`cron` | `issue`) vs a simple
   entry in `app_settings`?

3. **Prompt templating**: How much interpolation is needed?
   Minimum: `{{issue.title}}`, `{{issue.description}}`. More: `{{issue.assignee}}`,
   `{{issue.labels}}`, `{{issue.project}}`?

4. **Feedback**: After the agent run, should the daemon:
   - Post output as a comment on the issue? (always)
   - Change issue status? (to what — `in_progress` on start, `done` on complete?)
   - Both? Configurable?

5. **Re-trigger guard**: If an issue is already running, should a second
   `issue_eligible` notification be ignored? (Yes — similar to the `last_run_at`
   guard in `enqueueScheduleRun`.)

6. **Per-issue workspaces**: Start with shared `workingDirectory` per workflow,
   or implement Symphony-style per-issue isolation from the start?

7. **Who evaluates eligibility**: Should the web server filter at the API level
   (only emit pg_notify for truly eligible issues), or should the daemon fetch
   the issue and decide? Web server is simpler; daemon is more flexible.
