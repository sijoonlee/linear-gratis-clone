import { execFile } from 'child_process';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { normalizeAgentCli, type AgentCli } from '../lib/agent-cli';

const exec = promisify(execFile);

type ApiClient = <T>(path: string, options?: RequestInit) => Promise<T>;

type AgentUserRow = {
  id: string | null;
  type: string | null;
  agentCli: string | null;
  agentModel: string | null;
  permissionMode: string | null;
};

type IssueDetailRow = {
  id: string;
  title: string;
  description: string | null;
  teamId: string;
  projectId: string | null;
  statusId: string;
  statusName: string | null;
  statusType: string | null;
  projectName: string | null;
  projectWorkingDirectory?: string | null;
  assigneeId: string | null;
  assigneeType: string | null;
  assigneeAgentCli: string | null;
  assigneeAgentModel: string | null;
  assigneePermissionMode: string | null;
};

type IssueStatusRow = {
  id: string;
  name: string;
  type: string;
};

type ProjectRow = {
  id: string;
  workingDirectory: string | null;
};

type CommandSpec = {
  command: string;
  args: string[];
};

const activeIssueRuns = new Set<string>();

function permissionModeArg(mode: string) {
  switch (mode) {
    case 'auto': return 'auto';
    case 'accept-edits': return 'acceptEdits';
    case 'plan': return 'plan';
    default: return 'default';
  }
}

function codexApprovalPolicyArg(mode: string | null | undefined) {
  switch (mode) {
    case 'auto': return 'never';
    case 'plan': return 'never';
    default: return 'on-request';
  }
}

function codexSandboxArg(mode: string | null | undefined) {
  return mode === 'plan' ? 'read-only' : 'workspace-write';
}

function commandForAgentCli(agentCli: AgentCli, agentUser: AgentUserRow, prompt: string): CommandSpec {
  if (agentCli === 'codex') {
    const args = [
      '--ask-for-approval',
      codexApprovalPolicyArg(agentUser.permissionMode),
      'exec',
      '--ephemeral',
      '--skip-git-repo-check',
      '--color',
      'never',
      '-s',
      codexSandboxArg(agentUser.permissionMode),
    ];
    const model = agentUser.agentModel?.trim();
    if (model) args.push('--model', model);
    args.push(prompt);
    return { command: 'codex', args };
  }

  const model = agentUser.agentModel ?? 'claude-sonnet-4-6';
  const perm = permissionModeArg(agentUser.permissionMode ?? 'ask');
  return {
    command: 'claude',
    args: ['--print', prompt, '--model', model, '--permission-mode', perm],
  };
}

function slugifyIssue(issue: IssueDetailRow) {
  const titleSlug = issue.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${titleSlug || 'issue'}-${issue.id.slice(0, 8)}`;
}

function artifactPath(workingDirectory: string, slug: string, kind: string) {
  return path.join(workingDirectory, '.code-workflow', `${slug}-${kind}.md`);
}

function buildIssueMarkdown(issue: IssueDetailRow) {
  return [
    `# ${issue.title}`,
    '',
    `Issue ID: ${issue.id}`,
    `Status: ${issue.statusName ?? issue.statusType ?? 'Unknown'}`,
    `Project: ${issue.projectName ?? issue.projectId ?? 'None'}`,
    '',
    '## Description',
    '',
    issue.description?.trim() || '_No description provided._',
    '',
  ].join('\n');
}

function buildPlanningPrompt(issue: IssueDetailRow, issuePath: string, planPath: string) {
  return [
    `You are the planning agent for issue ${issue.id}.`,
    '',
    'Read:',
    issuePath,
    '',
    'Write the implementation plan to:',
    planPath,
    '',
    'Rules:',
    '- Do not modify source code.',
    '- Inspect relevant files before writing the plan.',
    '- Include affected files, approach, assumptions, risks, and validation.',
    '- When done, respond with a short summary.',
  ].join('\n');
}

async function readRequiredArtifact(filePath: string) {
  const content = await readFile(filePath, 'utf8');
  if (!content.trim()) {
    throw new Error(`required artifact is empty: ${filePath}`);
  }
  return content;
}

export async function dispatchIssueToPlan(issueId: string, api: ApiClient) {
  if (activeIssueRuns.has(issueId)) {
    console.log(`[issue:${issueId}] dispatch skipped; run already active`);
    return;
  }

  activeIssueRuns.add(issueId);
  try {
    const { data: issue } = await api<{ data: IssueDetailRow | null }>(`/api/issues/${issueId}`);
    if (!issue) {
      console.error(`[issue:${issueId}] not found`);
      return;
    }

    if (issue.statusType !== 'todo') {
      console.log(`[issue:${issueId}] dispatch skipped; status is ${issue.statusName ?? issue.statusType}`);
      return;
    }
    if (!issue.projectId) {
      console.log(`[issue:${issueId}] dispatch skipped; project is required`);
      return;
    }

    let projectWorkingDirectory = issue.projectWorkingDirectory?.trim() ?? '';
    if (!projectWorkingDirectory) {
      const { data: project } = await api<{ data: ProjectRow | null }>(`/api/projects/${issue.projectId}`);
      projectWorkingDirectory = project?.workingDirectory?.trim() ?? '';
    }

    if (!projectWorkingDirectory) {
      console.log(`[issue:${issueId}] dispatch skipped; project ${issue.projectId} working directory is required`);
      return;
    }
    if (issue.assigneeType !== 'agent' || !issue.assigneeAgentCli) {
      console.log(`[issue:${issueId}] dispatch skipped; issue must be assigned to an AI agent user`);
      return;
    }

    const { data: statuses } = await api<{ data: IssueStatusRow[] }>(`/api/statuses?teamId=${issue.teamId}`);
    const planBeforeReview = statuses.find(status => status.name === 'Plan - Before Review');
    if (!planBeforeReview) {
      throw new Error(`team ${issue.teamId} is missing "Plan - Before Review" status`);
    }

    const slug = slugifyIssue(issue);
    const workflowDirectory = path.join(projectWorkingDirectory, '.code-workflow');
    const issuePath = artifactPath(projectWorkingDirectory, slug, 'issue');
    const planPath = artifactPath(projectWorkingDirectory, slug, 'plan');

    await mkdir(workflowDirectory, { recursive: true });
    await writeFile(issuePath, buildIssueMarkdown(issue), 'utf8');

    const agentUser: AgentUserRow = {
      id: issue.assigneeId,
      type: issue.assigneeType,
      agentCli: issue.assigneeAgentCli,
      agentModel: issue.assigneeAgentModel,
      permissionMode: issue.assigneePermissionMode,
    };
    const agentCli = normalizeAgentCli(agentUser.agentCli);
    const prompt = buildPlanningPrompt(issue, issuePath, planPath);
    const { command, args } = commandForAgentCli(agentCli, agentUser, prompt);

    console.log(`[issue:${issueId}] planning with ${command}`);
    const child = exec(command, args, {
      cwd: projectWorkingDirectory,
      timeout: 10 * 60 * 1000,
    });
    child.child.stdin?.end();
    await child;

    const plan = await readRequiredArtifact(planPath);

    await api(`/api/issues/${issueId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content: plan }),
    });
    await api(`/api/issues/${issueId}`, {
      method: 'PATCH',
      body: JSON.stringify({ statusId: planBeforeReview.id }),
    });

    console.log(`[issue:${issueId}] moved to Plan - Before Review`);
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const details = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').trim();
    console.error(`[issue:${issueId}] planning failed`, details || err);
    await api('/api/notifications', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Issue planning failed',
        body: details.slice(0, 240) || `Issue ${issueId} failed during planning`,
        type: 'error',
      }),
    }).catch(() => {});
  } finally {
    activeIssueRuns.delete(issueId);
  }
}
