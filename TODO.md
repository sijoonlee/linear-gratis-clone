# TODO

## Realtime Issue Updates

Goal: keep issue list, board, and detail views in sync when Conductor moves or edits issues outside the current browser session.

Current state:
- Browser issue views fetch issue data on load.
- Local drag/drop and detail edits optimistically update the current view.
- Conductor can update an issue through the API, but open browser views do not refresh after that server-side change.
- Existing SSE support is notification-specific: `/api/notifications/stream` only sends notification payloads to the notification bell.

Recommended approach:
- Use Server-Sent Events for one-way server-to-browser issue change notifications.
- Add an issue event stream, e.g. `/api/issues/stream`, instead of overloading notification events.
- Publish an event after issue create/update/delete and after Conductor-driven moves.
- Event payload should include enough routing metadata to refresh cheaply:
  - `type`: `issue.created` | `issue.updated` | `issue.deleted`
  - `issueId`
  - `teamId`
  - changed fields, especially `statusId`, `sortOrder`, `assigneeId`, `projectId`, `priority`, `labelIds`
  - `updatedAt`
- Subscribe from `/issues`, issue detail pages, and project issue lists.
- On relevant events, either patch local state from the payload or refetch the affected issue/list.

Implementation notes:
- Start with refetching affected data after an event; optimize into local patching only if refetch churn becomes a problem.
- Filter client-side by active team/project/view query so unrelated team events do not disturb the current page.
- Keep notifications separate from data freshness; a conductor move may update the board without needing a visible notification.
- If the app runs across multiple Node processes or serverless instances, the current module-level subscriber pattern will not be enough; use a shared pub/sub backend such as Redis, Postgres listen/notify, or a hosted realtime channel.

## Visual View Query Composer

Goal: make the Views page help users compose saved issue query expressions visually, without building a full parser-backed query builder.

Current state:
- Views store `filters` as JSON with a `query` string.
- Opening a view redirects to `/issues?query=...`.
- Issues page safely evaluates the query without `eval`.
- Supported query examples:
  - `priority == "urgent"`
  - `(priority == "urgent" || priority == "high") && labels.includes("bug")`
  - `labels.includes("frontend") && !labels.includes("blocked")`
  - `assignee == "sijoon" && status != "Done"`

Composer approach:
- Keep the raw query textarea as the source of truth.
- Add a visual helper/palette next to or below the textarea.
- Palette chips append snippets into the textarea, preferably at the current cursor position.
- Do not fully validate while composing; invalid expressions are acceptable.
- Validation still happens when the view opens the Issues page.

Suggested chip groups:
- Operators: `&&`, `||`, `!`, `(`, `)`
- Field snippets:
  - `title == ""`
  - `priority == ""`
  - `status == ""`
  - `project == ""`
  - `assignee == ""`
  - `labels.includes("")`
- Actual value snippets:
  - `priority == "urgent"`
  - `priority == "high"`
  - `status == "Todo"`
  - `project == "Launch"`
  - `assignee == "sijoon"`
  - `labels.includes("bug")`

Example interaction:
1. User clicks status `Todo` → query becomes `status == "Todo"`
2. User clicks `AND` → query becomes `status == "Todo" &&`
3. User clicks label `bug` → query becomes `status == "Todo" && labels.includes("bug")`

Implementation notes:
- Add an `insertQueryText(snippet)` helper.
- If the textarea is focused, insert at cursor/selection.
- If not focused, append to the end with reasonable spacing.
- Operators should include spacing automatically: ` && `, ` || `.
- Snippets should use double quotes to match current examples.
- Preserve manual editing at all times.
- Add short instruction text explaining that holding Shift inserts a negative condition.
- While Shift is held, value chips should visibly switch into negative mode, e.g. red outline/tint.
- Shift-clicking a value snippet should insert the negative equivalent:
  - `status == "Todo"` becomes `status != "Todo"`
  - `priority == "urgent"` becomes `priority != "urgent"`
  - `labels.includes("bug")` becomes `!labels.includes("bug")`

Useful API data sources:
- `/api/statuses?teamId=...`
- `/api/projects?teamId=...`
- `/api/users`
- `/api/labels?teamId=...`

Decisions:
- Include negative conditions in v1 through Shift-modified value chips.
- Do not add a separate negated chip for every value in v1; use the Shift interaction to keep the palette compact.
- Defer generated human-readable summaries. Reliable summaries require parsing enough of the query expression to avoid misleading output, which is outside this composer scope.
