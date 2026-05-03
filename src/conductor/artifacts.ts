import { readFile, writeFile } from 'fs/promises';
import path from 'path';

export type RunLogEntry = {
  issueId: string;
  slug: string;
  phase: string;
  status: 'success' | 'failed' | 'skipped';
  startedAt: string;
  finishedAt: string;
  agentUserId: string | null;
  agentCli: string | null;
  agentModel: string | null;
  exitCode: number | null;
  error: string | null;
  artifactsRead: string[];
  artifactsWritten: string[];
  fromStatus: string | null;
  toStatus: string | null;
};

type IssueForSlug = {
  id: string;
  title: string;
};

type IssueForMarkdown = {
  title: string;
  id: string;
  statusName: string | null;
  statusType: string | null;
  projectName: string | null;
  projectId: string | null;
  description: string | null;
};

export function slugifyIssue(issue: IssueForSlug): string {
  const titleSlug = issue.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${titleSlug || 'issue'}-${issue.id.slice(0, 8)}`;
}

export function artifactPath(workingDirectory: string, slug: string, kind: string): string {
  return path.join(workingDirectory, '.code-workflow', `${slug}-${kind}.md`);
}

export function buildIssueMarkdown(issue: IssueForMarkdown): string {
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

export async function readRequiredArtifact(filePath: string): Promise<string> {
  const content = await readFile(filePath, 'utf8');
  if (!content.trim()) {
    throw new Error(`required artifact is empty: ${filePath}`);
  }
  return content;
}

export function parseDecision(content: string): 'Approved' | 'Disapproved' | null {
  const matches: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const m = line.trim().match(/^Decision:\s*(Approved|Disapproved)\s*$/i);
    if (m) matches.push(m[1].toLowerCase());
  }
  if (matches.length === 1) {
    return matches[0] === 'approved' ? 'Approved' : 'Disapproved';
  }
  return null;
}

export async function appendRunLog(
  workingDirectory: string,
  slug: string,
  entry: RunLogEntry,
): Promise<void> {
  const logPath = path.join(workingDirectory, '.code-workflow', `${slug}-run-log.json`);
  let entries: RunLogEntry[] = [];
  try {
    const raw = await readFile(logPath, 'utf8');
    entries = JSON.parse(raw) as RunLogEntry[];
  } catch {
    // file doesn't exist yet or is malformed — start fresh
  }
  entries.push(entry);
  await writeFile(logPath, JSON.stringify(entries, null, 2), 'utf8');
}

export function countPhaseAttempts(entries: RunLogEntry[], phase: string): number {
  return entries.filter(e => e.phase === phase).length;
}

export async function readRunLog(
  workingDirectory: string,
  slug: string,
): Promise<RunLogEntry[]> {
  const logPath = path.join(workingDirectory, '.code-workflow', `${slug}-run-log.json`);
  try {
    const raw = await readFile(logPath, 'utf8');
    return JSON.parse(raw) as RunLogEntry[];
  } catch {
    return [];
  }
}
