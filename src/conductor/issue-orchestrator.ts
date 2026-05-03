import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { type ApiClient } from './api-client';
import {
  commandForAgentCliWithNormalization,
  runAgent,
  type AgentUserRow,
} from './agent-runner';
import {
  slugifyIssue,
  artifactPath,
  buildIssueMarkdown,
  readRequiredArtifact,
  parseDecision,
  appendRunLog,
  readRunLog,
  countPhaseAttempts,
  type RunLogEntry,
} from './artifacts';

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

const AGENT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_PHASE_RETRIES = 3;

const activeIssueRuns = new Set<string>();
const activeProjectRuns = new Map<string, Set<string>>();
const pendingDispatch = new Set<string>();

function acquireProjectSlot(projectId: string, issueId: string): boolean {
  const running = activeProjectRuns.get(projectId);
  if (running && running.size > 0) return false;
  if (!running) activeProjectRuns.set(projectId, new Set());
  activeProjectRuns.get(projectId)!.add(issueId);
  return true;
}

function releaseProjectSlot(projectId: string, issueId: string) {
  activeProjectRuns.get(projectId)?.delete(issueId);
}

function statusIdFor(statuses: IssueStatusRow[], name: string): string {
  const s = statuses.find(s => s.name === name);
  if (!s) throw new Error(`team is missing required status: "${name}"`);
  return s.id;
}

function agentUserFrom(issue: IssueDetailRow): AgentUserRow {
  return {
    id: issue.assigneeId,
    type: issue.assigneeType,
    agentCli: issue.assigneeAgentCli,
    agentModel: issue.assigneeAgentModel,
    permissionMode: issue.assigneePermissionMode,
  };
}

function buildPlanningPrompt(
  issue: IssueDetailRow,
  issuePath: string,
  planPath: string,
): string {
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

function buildPlanReviewPrompt(
  issue: IssueDetailRow,
  issuePath: string,
  planPath: string,
  reviewPath: string,
): string {
  return [
    `You are the plan reviewer for issue ${issue.id}.`,
    '',
    'Read:',
    issuePath,
    planPath,
    '',
    'Do not modify source code.',
    'Review correctness, scope, risk, missing details, and validation plan.',
    '',
    'Write your review to:',
    reviewPath,
    '',
    'The first line of that file must be exactly one of:',
    '  Decision: Approved',
    '  Decision: Disapproved',
    '',
    'Include rationale below the decision line.',
  ].join('\n');
}

function buildCodingPrompt(
  issue: IssueDetailRow,
  issuePath: string,
  planPath: string,
  planReviewPath: string,
  implementationPath: string,
): string {
  return [
    `You are the coding agent for issue ${issue.id}.`,
    '',
    'Read:',
    issuePath,
    planPath,
    planReviewPath,
    '',
    'Implement only the approved plan.',
    'Avoid unrelated refactors.',
    'Run relevant validation.',
    '',
    'Write your implementation summary to:',
    implementationPath,
    '',
    'Include changed files, validation results, and remaining risks.',
    'Do not commit unless explicitly instructed.',
  ].join('\n');
}

function buildCodeReviewPrompt(
  issue: IssueDetailRow,
  issuePath: string,
  planPath: string,
  planReviewPath: string,
  implementationPath: string,
  codeReviewPath: string,
): string {
  return [
    `You are the code reviewer for issue ${issue.id}.`,
    '',
    'Read:',
    issuePath,
    planPath,
    planReviewPath,
    implementationPath,
    '',
    'Review actual code changes and validation evidence.',
    'Prioritize bugs, regressions, missing tests, and scope violations.',
    'Do not modify source code.',
    '',
    'Write your review to:',
    codeReviewPath,
    '',
    'The first line of that file must be exactly one of:',
    '  Decision: Approved',
    '  Decision: Disapproved',
  ].join('\n');
}

async function postComment(issueId: string, content: string, api: ApiClient): Promise<void> {
  await api(`/api/issues/${issueId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

async function moveIssueTo(issueId: string, statusId: string, api: ApiClient): Promise<void> {
  await api(`/api/issues/${issueId}`, {
    method: 'PATCH',
    body: JSON.stringify({ statusId }),
  });
}

async function postError(issueId: string, message: string, api: ApiClient): Promise<void> {
  await api('/api/notifications', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Issue orchestration failed',
      body: message.slice(0, 240),
      type: 'error',
    }),
  }).catch(() => {});
}

async function handlePlanning(
  issue: IssueDetailRow,
  workingDir: string,
  statuses: IssueStatusRow[],
  api: ApiClient,
): Promise<void> {
  const slug = slugifyIssue(issue);
  const workflowDirectory = path.join(workingDir, '.code-workflow');
  const issuePath = artifactPath(workingDir, slug, 'issue');
  const planPath = artifactPath(workingDir, slug, 'plan');
  const agentUser = agentUserFrom(issue);
  const startedAt = new Date().toISOString();

  await mkdir(workflowDirectory, { recursive: true });
  await writeFile(issuePath, buildIssueMarkdown(issue), 'utf8');

  const prompt = buildPlanningPrompt(issue, issuePath, planPath);
  const spec = commandForAgentCliWithNormalization(agentUser, prompt);

  console.log(`[issue:${issue.id}] planning with ${spec.command}`);
  await runAgent(spec, workingDir, AGENT_TIMEOUT_MS);

  const plan = await readRequiredArtifact(planPath);
  await postComment(issue.id, plan, api);
  await moveIssueTo(issue.id, statusIdFor(statuses, 'Plan - Before Review'), api);

  await appendRunLog(workingDir, slug, {
    issueId: issue.id, slug, phase: 'planning', status: 'success',
    startedAt, finishedAt: new Date().toISOString(),
    agentUserId: agentUser.id ?? null, agentCli: agentUser.agentCli, agentModel: agentUser.agentModel,
    exitCode: 0, error: null,
    artifactsRead: [issuePath], artifactsWritten: [planPath],
    fromStatus: issue.statusName, toStatus: 'Plan - Before Review',
  });

  console.log(`[issue:${issue.id}] moved to Plan - Before Review`);
}

async function handlePlanReview(
  issue: IssueDetailRow,
  workingDir: string,
  statuses: IssueStatusRow[],
  api: ApiClient,
): Promise<void> {
  const slug = slugifyIssue(issue);
  const issuePath = artifactPath(workingDir, slug, 'issue');
  const planPath = artifactPath(workingDir, slug, 'plan');
  const reviewPath = artifactPath(workingDir, slug, 'plan-review');
  const agentUser = agentUserFrom(issue);
  const startedAt = new Date().toISOString();

  await readRequiredArtifact(issuePath);
  await readRequiredArtifact(planPath);

  await moveIssueTo(issue.id, statusIdFor(statuses, 'Plan - In Review'), api);
  console.log(`[issue:${issue.id}] plan review started`);

  const prompt = buildPlanReviewPrompt(issue, issuePath, planPath, reviewPath);
  const spec = commandForAgentCliWithNormalization(agentUser, prompt);
  await runAgent(spec, workingDir, AGENT_TIMEOUT_MS);

  const reviewContent = await readRequiredArtifact(reviewPath);
  const decision = parseDecision(reviewContent);

  if (!decision) {
    await postError(
      issue.id,
      `[issue:${issue.id}] plan review produced no clear decision; check ${reviewPath}`,
      api,
    );
    throw new Error(`plan review artifact has no clear Decision line: ${reviewPath}`);
  }

  await postComment(issue.id, reviewContent, api);
  const targetStatus = decision === 'Approved' ? 'Plan - Approved' : 'Plan - Disapproved';
  await moveIssueTo(issue.id, statusIdFor(statuses, targetStatus), api);

  await appendRunLog(workingDir, slug, {
    issueId: issue.id, slug, phase: 'plan-review', status: 'success',
    startedAt, finishedAt: new Date().toISOString(),
    agentUserId: agentUser.id ?? null, agentCli: agentUser.agentCli, agentModel: agentUser.agentModel,
    exitCode: 0, error: null,
    artifactsRead: [issuePath, planPath], artifactsWritten: [reviewPath],
    fromStatus: issue.statusName, toStatus: targetStatus,
  });

  console.log(`[issue:${issue.id}] plan review decision: ${decision} → ${targetStatus}`);
}

async function handleCoding(
  issue: IssueDetailRow,
  workingDir: string,
  statuses: IssueStatusRow[],
  api: ApiClient,
): Promise<void> {
  if (!issue.projectId) throw new Error('coding phase requires projectId');

  const slug = slugifyIssue(issue);
  const issuePath = artifactPath(workingDir, slug, 'issue');
  const planPath = artifactPath(workingDir, slug, 'plan');
  const planReviewPath = artifactPath(workingDir, slug, 'plan-review');
  const implementationPath = artifactPath(workingDir, slug, 'implementation');
  const agentUser = agentUserFrom(issue);
  const startedAt = new Date().toISOString();

  await readRequiredArtifact(issuePath);
  await readRequiredArtifact(planPath);
  const planReviewContent = await readRequiredArtifact(planReviewPath);
  const planDecision = parseDecision(planReviewContent);
  if (planDecision !== 'Approved') {
    throw new Error(`coding phase requires approved plan; plan-review decision: ${planDecision}`);
  }

  if (!acquireProjectSlot(issue.projectId, issue.id)) {
    console.log(`[issue:${issue.id}] coding skipped; project ${issue.projectId} has active run`);
    return;
  }

  try {
    await moveIssueTo(issue.id, statusIdFor(statuses, 'Coding in Process'), api);
    console.log(`[issue:${issue.id}] coding started`);

    const prompt = buildCodingPrompt(issue, issuePath, planPath, planReviewPath, implementationPath);
    const spec = commandForAgentCliWithNormalization(agentUser, prompt);
    await runAgent(spec, workingDir, AGENT_TIMEOUT_MS);

    const implementation = await readRequiredArtifact(implementationPath);
    await postComment(issue.id, implementation, api);
    await moveIssueTo(issue.id, statusIdFor(statuses, 'Code - Before Review'), api);

    await appendRunLog(workingDir, slug, {
      issueId: issue.id, slug, phase: 'coding', status: 'success',
      startedAt, finishedAt: new Date().toISOString(),
      agentUserId: agentUser.id ?? null, agentCli: agentUser.agentCli, agentModel: agentUser.agentModel,
      exitCode: 0, error: null,
      artifactsRead: [issuePath, planPath, planReviewPath],
      artifactsWritten: [implementationPath],
      fromStatus: issue.statusName, toStatus: 'Code - Before Review',
    });

    console.log(`[issue:${issue.id}] moved to Code - Before Review`);
  } finally {
    releaseProjectSlot(issue.projectId, issue.id);
  }
}

async function handleCodeReview(
  issue: IssueDetailRow,
  workingDir: string,
  statuses: IssueStatusRow[],
  api: ApiClient,
): Promise<void> {
  const slug = slugifyIssue(issue);
  const issuePath = artifactPath(workingDir, slug, 'issue');
  const planPath = artifactPath(workingDir, slug, 'plan');
  const planReviewPath = artifactPath(workingDir, slug, 'plan-review');
  const implementationPath = artifactPath(workingDir, slug, 'implementation');
  const codeReviewPath = artifactPath(workingDir, slug, 'code-review');
  const agentUser = agentUserFrom(issue);
  const startedAt = new Date().toISOString();

  await readRequiredArtifact(issuePath);
  await readRequiredArtifact(planPath);
  await readRequiredArtifact(planReviewPath);
  await readRequiredArtifact(implementationPath);

  await moveIssueTo(issue.id, statusIdFor(statuses, 'Code - In Review'), api);
  console.log(`[issue:${issue.id}] code review started`);

  const prompt = buildCodeReviewPrompt(
    issue, issuePath, planPath, planReviewPath, implementationPath, codeReviewPath,
  );
  const spec = commandForAgentCliWithNormalization(agentUser, prompt);
  await runAgent(spec, workingDir, AGENT_TIMEOUT_MS);

  const reviewContent = await readRequiredArtifact(codeReviewPath);
  const decision = parseDecision(reviewContent);

  if (!decision) {
    await postError(
      issue.id,
      `[issue:${issue.id}] code review produced no clear decision; check ${codeReviewPath}`,
      api,
    );
    throw new Error(`code review artifact has no clear Decision line: ${codeReviewPath}`);
  }

  await postComment(issue.id, reviewContent, api);
  const targetStatus = decision === 'Approved' ? 'Code - Approved' : 'Code - Disapproved';
  await moveIssueTo(issue.id, statusIdFor(statuses, targetStatus), api);

  await appendRunLog(workingDir, slug, {
    issueId: issue.id, slug, phase: 'code-review', status: 'success',
    startedAt, finishedAt: new Date().toISOString(),
    agentUserId: agentUser.id ?? null, agentCli: agentUser.agentCli, agentModel: agentUser.agentModel,
    exitCode: 0, error: null,
    artifactsRead: [issuePath, planPath, planReviewPath, implementationPath],
    artifactsWritten: [codeReviewPath],
    fromStatus: issue.statusName, toStatus: targetStatus,
  });

  console.log(`[issue:${issue.id}] code review decision: ${decision} → ${targetStatus}`);
}

async function handleCompletion(
  issue: IssueDetailRow,
  workingDir: string,
  statuses: IssueStatusRow[],
  api: ApiClient,
): Promise<void> {
  const slug = slugifyIssue(issue);
  const codeReviewPath = artifactPath(workingDir, slug, 'code-review');
  const completionPath = artifactPath(workingDir, slug, 'completion');
  const startedAt = new Date().toISOString();

  const codeReviewContent = await readRequiredArtifact(codeReviewPath);
  const decision = parseDecision(codeReviewContent);
  if (decision !== 'Approved') {
    throw new Error(`completion phase requires approved code review; decision: ${decision}`);
  }

  const completionContent = [
    `# Completion: ${issue.title}`,
    '',
    `Issue ID: ${issue.id}`,
    `Completed: ${new Date().toISOString()}`,
    '',
    '## Artifacts',
    '',
    `- ${artifactPath(workingDir, slug, 'issue')}`,
    `- ${artifactPath(workingDir, slug, 'plan')}`,
    `- ${artifactPath(workingDir, slug, 'plan-review')}`,
    `- ${artifactPath(workingDir, slug, 'implementation')}`,
    `- ${artifactPath(workingDir, slug, 'code-review')}`,
    '',
  ].join('\n');

  await writeFile(completionPath, completionContent, 'utf8');
  await postComment(issue.id, completionContent, api);
  await moveIssueTo(issue.id, statusIdFor(statuses, 'Done'), api);

  await appendRunLog(workingDir, slug, {
    issueId: issue.id, slug, phase: 'completion', status: 'success',
    startedAt, finishedAt: new Date().toISOString(),
    agentUserId: null, agentCli: null, agentModel: null,
    exitCode: 0, error: null,
    artifactsRead: [codeReviewPath], artifactsWritten: [completionPath],
    fromStatus: issue.statusName, toStatus: 'Done',
  });

  console.log(`[issue:${issue.id}] moved to Done`);
}

async function handlePlanRetry(
  issue: IssueDetailRow,
  workingDir: string,
  statuses: IssueStatusRow[],
  api: ApiClient,
): Promise<void> {
  const slug = slugifyIssue(issue);
  const runLog = await readRunLog(workingDir, slug);
  const attempts = countPhaseAttempts(runLog, 'planning');

  if (attempts >= MAX_PHASE_RETRIES) {
    await postError(
      issue.id,
      `[issue:${issue.id}] plan retry limit reached (${attempts} attempts); manual intervention required`,
      api,
    );
    console.log(`[issue:${issue.id}] plan retry limit reached`);
    return;
  }

  await moveIssueTo(issue.id, statusIdFor(statuses, 'Todo'), api);
  console.log(`[issue:${issue.id}] plan disapproved → reset to Todo (attempt ${attempts + 1})`);
}

async function handleCodeRetry(
  issue: IssueDetailRow,
  workingDir: string,
  statuses: IssueStatusRow[],
  api: ApiClient,
): Promise<void> {
  const slug = slugifyIssue(issue);
  const runLog = await readRunLog(workingDir, slug);
  const attempts = countPhaseAttempts(runLog, 'coding');

  if (attempts >= MAX_PHASE_RETRIES) {
    await postError(
      issue.id,
      `[issue:${issue.id}] code retry limit reached (${attempts} attempts); manual intervention required`,
      api,
    );
    console.log(`[issue:${issue.id}] code retry limit reached`);
    return;
  }

  await moveIssueTo(issue.id, statusIdFor(statuses, 'Coding in Process'), api);
  console.log(`[issue:${issue.id}] code disapproved → reset to Coding in Process (attempt ${attempts + 1})`);
}

export async function dispatchIssue(issueId: string, api: ApiClient): Promise<void> {
  if (activeIssueRuns.has(issueId)) {
    pendingDispatch.add(issueId);
    console.log(`[issue:${issueId}] dispatch queued; run already active`);
    return;
  }

  activeIssueRuns.add(issueId);
  try {
    const { data: issue } = await api<{ data: IssueDetailRow | null }>(`/api/issues/${issueId}`);
    if (!issue) {
      console.error(`[issue:${issueId}] not found`);
      return;
    }

    const terminalTypes = ['backlog', 'done', 'cancelled'];
    if (terminalTypes.includes(issue.statusType ?? '')) {
      console.log(`[issue:${issueId}] dispatch skipped; status is terminal (${issue.statusName})`);
      return;
    }
    if (!issue.projectId) {
      console.log(`[issue:${issueId}] dispatch skipped; project is required`);
      return;
    }
    if (issue.assigneeType !== 'agent' || !issue.assigneeAgentCli) {
      console.log(`[issue:${issueId}] dispatch skipped; issue must be assigned to an AI agent user`);
      return;
    }

    let workingDir = issue.projectWorkingDirectory?.trim() ?? '';
    if (!workingDir) {
      const { data: project } = await api<{ data: ProjectRow | null }>(`/api/projects/${issue.projectId}`);
      workingDir = project?.workingDirectory?.trim() ?? '';
    }
    if (!workingDir) {
      console.log(`[issue:${issueId}] dispatch skipped; project working directory is required`);
      return;
    }

    const { data: statuses } = await api<{ data: IssueStatusRow[] }>(`/api/statuses?teamId=${issue.teamId}`);

    const name = issue.statusName;
    const type = issue.statusType;

    if (type === 'todo') {
      await handlePlanning(issue, workingDir, statuses, api);
    } else if (name === 'Plan - Before Review') {
      await handlePlanReview(issue, workingDir, statuses, api);
    } else if (name === 'Plan - Approved') {
      await handleCoding(issue, workingDir, statuses, api);
    } else if (name === 'Coding in Process') {
      await handleCoding(issue, workingDir, statuses, api);
    } else if (name === 'Code - Before Review') {
      await handleCodeReview(issue, workingDir, statuses, api);
    } else if (name === 'Code - Approved') {
      await handleCompletion(issue, workingDir, statuses, api);
    } else if (name === 'Plan - Disapproved') {
      await handlePlanRetry(issue, workingDir, statuses, api);
    } else if (name === 'Code - Disapproved') {
      await handleCodeRetry(issue, workingDir, statuses, api);
    } else {
      console.log(`[issue:${issueId}] dispatch skipped; no handler for status "${name}"`);
    }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const details = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').trim();
    console.error(`[issue:${issueId}] orchestration failed`, details || err);
    await api('/api/notifications', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Issue orchestration failed',
        body: details.slice(0, 240) || `Issue ${issueId} failed`,
        type: 'error',
      }),
    }).catch(() => {});
  } finally {
    activeIssueRuns.delete(issueId);
    if (pendingDispatch.delete(issueId)) {
      setImmediate(() => {
        dispatchIssue(issueId, api).catch(err =>
          console.error(`[issue:${issueId}] re-dispatch failed`, err)
        );
      });
    }
  }
}
