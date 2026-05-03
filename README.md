# Linear Clone

A self-hosted project management tool that mirrors Linear's interface and workflow. No accounts, no subscriptions, no external services — just a Next.js app backed by a local Postgres database.

## Features

### Issues
- Create, edit, and track issues with status, priority, labels, estimates, and due dates
- Assign issues to team members
- Inline title and description editing
- Label assign/unassign directly from the issue detail page, including creating new labels inline
- Comments and field-level activity history
- List view (grouped by status) and Kanban board with drag-and-drop

### Users & Teams
- Register multiple users; switch active user from the sidebar
- Create teams with a name, identifier, and color
- Users can join or leave any team (M:N relationship)
- Members page shows who belongs to the active team

### Labels
- Per-team labels with name and color
- Full CRUD from the Labels page
- Assign/unassign multiple labels per issue; create new labels directly from the issue detail sidebar

### Projects & Roadmap
- Group issues into projects with status and target dates
- Roadmap — horizontal timeline view of projects across time

### Schedules
- Define recurring agent tasks (prompt, optional working directory, cron expression, model)
- Track execution history per schedule

### Other
- Views — saved safe query presets for issue lists
- Linear-accurate UI — status icons, priority icons, and color system

## Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 15 (App Router) |
| Database | PostgreSQL 16 |
| ORM | Drizzle ORM |
| Styling | Tailwind CSS v4 |
| UI | Radix UI + custom components |

## Getting Started

### Prerequisites

- Node.js 18+
- Docker (for local Postgres)

### 1. Install dependencies

```bash
npm install
```

### 2. Start the database

```bash
docker-compose up -d
```

Starts a Postgres 16 container on port 5432:
- **Database:** `linearclone`
- **User:** `postgres`
- **Password:** `postgres`

### 3. Configure environment

```bash
cp .env.example .env.local
```

`.env.local` only needs one variable:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/linearclone
```

### 4. Run migrations

```bash
npm run db:migrate
```

### 5. Seed sample data (optional)

```bash
npm run db:seed
```

Creates a default user, team, statuses, labels, project, issues, schedule, and roadmap.

### 6. Start the dev server

```bash
npm run dev
```

Opens at [http://localhost:3000](http://localhost:3000) and redirects to `/issues`.

If no user exists yet, click **Register** in the sidebar to create one, then go to **Teams** to join a team.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run db:migrate` | Apply pending migrations to the database |
| `npm run db:studio` | Open Drizzle Studio (visual DB browser) |
| `npm run db:seed` | Seed the database with sample data |
| `npm run conductor` | Start the conductor |

## Database Schema

| Table | Purpose |
|-------|---------|
| `users` | App users — name, email, avatar |
| `teams` | Workspace groups with name and identifier (e.g. `ENG`) |
| `team_members` | M:N join between users and teams, with role (owner/member) |
| `issue_statuses` | Per-team issue workflow statuses (Backlog, Todo, Plan review, Coding in Process, Code review, Done, Cancelled) |
| `labels` | Per-team labels with color |
| `projects` | Collections of issues with status and dates |
| `issues` | Core entity — title, description, status, priority, assignee, estimate, due date |
| `issue_labels` | M:N join between issues and labels |
| `comments` | Comments on issues |
| `issue_history` | Field-level audit log for issue changes |
| `roadmaps` | Named collections of projects |
| `roadmap_projects` | M:N join between roadmaps and projects |
| `schedules` | Claude Code agent task definitions (prompt, cron, model) |
| `cron_tasks` | Execution history for schedules |
| `views` | Saved filter presets |

## View Query Syntax

Saved views store a safe query expression and open the Issues page with `?query=...`.

Supported fields and operators:
- Fields: `title`, `priority`, `status`, `project`, `assignee`
- Labels: `labels.includes("label name")`
- Operators: `==`, `!=`, `&&`, `||`, `!`, parentheses

Examples:

```txt
priority == "urgent"
(priority == "urgent" || priority == "high") && labels.includes("bug")
labels.includes("frontend") && !labels.includes("blocked")
assignee == "sijoon" && status != "Done"
```

## API Routes

All routes return `{ data: ... }` on success or `{ error: "..." }` on failure.

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/users` | GET, POST | List / create users |
| `/api/users/[id]` | GET, PATCH, DELETE | User detail |
| `/api/users/[id]/teams` | GET | Teams the user has joined |
| `/api/teams` | GET, POST | List / create teams |
| `/api/teams/[id]` | GET, PATCH, DELETE | Team detail |
| `/api/teams/[id]/members` | GET, POST | List / add members |
| `/api/teams/[id]/members/[userId]` | DELETE | Remove a member |
| `/api/projects` | GET, POST | List (filter by `teamId`) / create |
| `/api/projects/[id]` | GET, PATCH, DELETE | Project detail |
| `/api/statuses` | GET, POST | List (filter by `teamId`) / create |
| `/api/statuses/[id]` | PATCH, DELETE | Update / delete status |
| `/api/labels` | GET, POST | List (filter by `teamId`) / create |
| `/api/labels/[id]` | PATCH, DELETE | Update / delete label |
| `/api/issues` | GET, POST | List (filter by team/project/status/priority) / create |
| `/api/issues/[id]` | GET, PATCH, DELETE | Issue detail with labels, comments, history |
| `/api/issues/[id]/comments` | GET, POST | Issue comments |
| `/api/comments/[id]` | PATCH, DELETE | Edit / delete comment |
| `/api/roadmaps` | GET, POST | List / create roadmaps |
| `/api/roadmaps/[id]` | GET, PATCH, DELETE | Roadmap detail with projects |
| `/api/schedules` | GET, POST | List / create schedules |
| `/api/schedules/[id]` | GET, PATCH, DELETE | Schedule detail |
| `/api/cron-tasks` | GET | List cron task execution history |
| `/api/cron-tasks/[id]` | GET | Single cron task |

## CDC Architecture (Schedule Execution)

Schedules are executed by a separate conductor process that watches Postgres for new tasks using Change Data Capture (CDC) via `LISTEN/NOTIFY` — a built-in Postgres pub/sub mechanism.

```
Browser
  │  (1) create cron_task (status: pending)
  ▼
Next.js web server ──────────────────── Postgres
  │                                        │
  │                          (2) trigger fires pg_notify
  │                                        │
  │                                        ▼
  │                                     Conductor
  │                          (3) LISTEN receives payload
  │                          (4) runs claude --print
  │                          (5) updates cron_task row
  │                                        │
  │◀────── (6) POST /api/notifications ────┘
  │
  ▼
Browser receives notification via SSE (bell icon updates instantly)
```

### How it works

1. User triggers a schedule manually, or the conductor detects a due enabled schedule → a `cron_task` row is inserted with `status: pending`
2. A Postgres trigger fires `pg_notify('cron_task_pending', payload)` on every insert
3. The conductor (a separate Node.js process) is connected to Postgres via `LISTEN` and receives the payload immediately
4. The conductor runs the selected agent CLI with the schedule's prompt and working directory, defaulting to the conductor directory when blank
5. The conductor writes the output, exit code, and final status back to the `cron_tasks` row
6. The conductor POSTs to `/api/notifications` on the web server
7. The web server pushes the notification to the browser via SSE — the bell icon updates without polling

### Running the conductor

The conductor does two jobs:
- Listens for pending `cron_tasks` via Postgres `LISTEN/NOTIFY`
- Listens for schedule changes via Postgres `LISTEN/NOTIFY` and registers enabled cron schedules as in-memory `node-cron` jobs

When a registered cron job fires, the conductor inserts a pending `cron_task`; the existing `cron_task_pending` trigger then wakes the task runner.

Scheduled tasks and cron-expression conversion use the AI agent selected on the schedule. The app currently supports Claude CLI and Codex CLI agent users.

```bash
# Terminal 1 — web server
npm run dev

# Terminal 2 — conductor
npm run conductor
```

The conductor reads `DATABASE_URL` from the environment (same as the web server). Optionally set `WEB_SERVER_URL` if the web server is not on `http://localhost:3000`.

## Deployment

Swap `DATABASE_URL` to a hosted Postgres instance (Railway, Supabase, Neon, etc.) and deploy the Next.js app anywhere that supports Node.js (Vercel, Railway, Fly.io, etc.).

```bash
npm run build
npm run start
```

No other changes needed — the app has no external service dependencies.

## License

MIT
