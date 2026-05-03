import { config } from 'dotenv';
config({ path: '.env.local' });

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });

async function seed() {
  console.log('Seeding database...');

  // User
  const [user] = await db.insert(schema.users).values({
    name: 'Sijoon Lee',
    email: 'shijoonlee@gmail.com',
  }).returning();
  console.log('Created user:', user.name);

  const [agentUser] = await db.insert(schema.users).values({
    name: 'Claude Sonnet Agent',
    email: 'claude-sonnet-agent@agent',
    type: 'agent',
    agentCli: 'claude',
    agentModel: 'claude-sonnet-4-6',
    permissionMode: 'ask',
  }).returning();
  console.log('Created agent user:', agentUser.name);

  // Team
  const [team] = await db.insert(schema.teams).values({
    name: 'Engineering',
    identifier: 'ENG',
    description: 'Core engineering team',
    color: '#5E6AD2',
  }).returning();

  console.log('Created team:', team.name);

  // Add user to team as owner
  await db.insert(schema.teamMembers).values({ teamId: team.id, userId: user.id, role: 'owner' });

  // Statuses
  const statusValues = [
    { teamId: team.id, name: 'Backlog',                  color: '#95A2B3', type: 'backlog'           as const, position: 0 },
    { teamId: team.id, name: 'Todo',                     color: '#95A2B3', type: 'todo'              as const, position: 1 },
    { teamId: team.id, name: 'Plan - Before Review',     color: '#7C3AED', type: 'plan'              as const, position: 2 },
    { teamId: team.id, name: 'Plan - In Review',         color: '#7C3AED', type: 'plan'              as const, position: 3 },
    { teamId: team.id, name: 'Plan - Approved',          color: '#10B981', type: 'plan'              as const, position: 4 },
    { teamId: team.id, name: 'Plan - Disapproved',       color: '#EF4444', type: 'plan'              as const, position: 5 },
    { teamId: team.id, name: 'Coding in Process',        color: '#F59E0B', type: 'coding_in_process' as const, position: 6 },
    { teamId: team.id, name: 'Code - Before Review',     color: '#2563EB', type: 'code'              as const, position: 7 },
    { teamId: team.id, name: 'Code - In Review',         color: '#2563EB', type: 'code'              as const, position: 8 },
    { teamId: team.id, name: 'Code - Approved',          color: '#10B981', type: 'code'              as const, position: 9 },
    { teamId: team.id, name: 'Code - Disapproved',       color: '#EF4444', type: 'code'              as const, position: 10 },
    { teamId: team.id, name: 'Done',                     color: '#26C281', type: 'done'              as const, position: 11 },
    { teamId: team.id, name: 'Cancelled',                color: '#95A2B3', type: 'cancelled'         as const, position: 12 },
  ];
  const statuses = await db.insert(schema.issueStatuses).values(statusValues).returning();
  console.log('Created statuses:', statuses.map(s => s.name).join(', '));

  const backlog     = statuses.find(s => s.name === 'Backlog')!;
  const todo        = statuses.find(s => s.name === 'Todo')!;
  const coding      = statuses.find(s => s.name === 'Coding in Process')!;
  const done        = statuses.find(s => s.name === 'Done')!;

  // Labels
  const labelValues = [
    { teamId: team.id, name: 'Bug',      color: '#EB5757' },
    { teamId: team.id, name: 'Feature',  color: '#5E6AD2' },
    { teamId: team.id, name: 'Improve',  color: '#26C281' },
    { teamId: team.id, name: 'Design',   color: '#F2C94C' },
  ];
  const createdLabels = await db.insert(schema.labels).values(labelValues).returning();
  console.log('Created labels:', createdLabels.map(l => l.name).join(', '));

  const bugLabel     = createdLabels.find(l => l.name === 'Bug')!;
  const featureLabel = createdLabels.find(l => l.name === 'Feature')!;

  // Project
  const [project] = await db.insert(schema.projects).values({
    teamId: team.id,
    name: 'Linear Clone',
    description: 'Self-hosted Linear clone project',
    status: 'in_progress',
    color: '#5E6AD2',
    workingDirectory: process.cwd(),
    startDate: new Date(),
    targetDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
  }).returning();

  console.log('Created project:', project.name);

  // Schedule
  const [schedule] = await db.insert(schema.schedules).values({
    teamId: team.id,
    agentUserId: agentUser.id,
    name: 'Daily standup summary',
    description: 'Summarise open issues and in-progress work for the team',
    prompt: 'Review the open issues in the Linear clone project and write a concise standup summary: what was done yesterday, what is in progress today, and any blockers.',
    cronExpression: '0 9 * * 1-5',
    workingDirectory: process.cwd(),
    enabled: true,
  }).returning();

  console.log('Created schedule:', schedule.name);

  // Issues
  const issueValues = [
    {
      teamId: team.id,
      projectId: project.id,
      statusId: done.id,
      title: 'Set up Next.js project',
      description: 'Initial project setup with Next.js 15, Tailwind, and TypeScript.',
      priority: 'high' as const,
      sortOrder: 0,
    },
    {
      teamId: team.id,
      projectId: project.id,
      statusId: done.id,
      title: 'Configure Drizzle ORM with Postgres',
      description: 'Set up Drizzle ORM, define schema, and run initial migrations.',
      priority: 'high' as const,
      sortOrder: 1,
    },
    {
      teamId: team.id,
      projectId: project.id,
      statusId: coding.id,
      title: 'Build sidebar navigation',
      description: 'Left sidebar with team switcher, issues, projects, schedules, views.',
      priority: 'high' as const,
      sortOrder: 0,
    },
    {
      teamId: team.id,
      projectId: project.id,
      statusId: coding.id,
      title: 'Build issues list view',
      description: 'Main issues list grouped by status with filter and sort controls.',
      priority: 'medium' as const,
      sortOrder: 1,
    },
    {
      teamId: team.id,
      projectId: project.id,
      statusId: todo.id,
      assigneeId: agentUser.id,
      title: 'Build issue detail page',
      description: 'Full issue detail with markdown editor, status/priority selectors, and comments.',
      priority: 'medium' as const,
      sortOrder: 0,
    },
    {
      teamId: team.id,
      projectId: project.id,
      statusId: todo.id,
      assigneeId: agentUser.id,
      title: 'Build kanban board',
      description: 'Drag-and-drop kanban view grouped by issue status.',
      priority: 'medium' as const,
      sortOrder: 1,
    },
    {
      teamId: team.id,
      projectId: project.id,
      statusId: backlog.id,
      title: 'Build roadmap timeline view',
      description: 'Timeline view showing projects and their due dates across a calendar.',
      priority: 'low' as const,
      sortOrder: 0,
    },
    {
      teamId: team.id,
      projectId: project.id,
      statusId: backlog.id,
      title: 'Add keyboard shortcuts',
      description: 'Implement Linear-style keyboard shortcuts: C to create issue, / to search, etc.',
      priority: 'low' as const,
      sortOrder: 1,
    },
  ];

  const createdIssues = await db.insert(schema.issues).values(issueValues).returning();
  console.log('Created issues:', createdIssues.length);

  // Attach labels to first two issues
  await db.insert(schema.issueLabels).values([
    { issueId: createdIssues[0].id, labelId: featureLabel.id },
    { issueId: createdIssues[1].id, labelId: featureLabel.id },
    { issueId: createdIssues[3].id, labelId: bugLabel.id },
  ]);

  // Roadmap
  const [roadmap] = await db.insert(schema.roadmaps).values({
    name: 'Product Roadmap',
    description: 'High-level view of planned work',
  }).returning();

  await db.insert(schema.roadmapProjects).values({
    roadmapId: roadmap.id,
    projectId: project.id,
  });

  console.log('Created roadmap:', roadmap.name);
  console.log('Seed complete.');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
