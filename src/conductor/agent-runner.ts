import { spawn } from 'child_process';
import { normalizeAgentCli, type AgentCli } from '../lib/agent-cli';

export type AgentUserRow = {
  id?: string | null;
  type?: string | null;
  agentCli: string | null;
  agentModel: string | null;
  permissionMode: string | null;
};

export type CommandSpec = {
  command: string;
  args: string[];
};

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

export function commandForAgentCli(
  agentCli: AgentCli,
  agentUser: AgentUserRow | null,
  prompt: string,
): CommandSpec {
  if (agentCli === 'codex') {
    const args = [
      '--ask-for-approval',
      codexApprovalPolicyArg(agentUser?.permissionMode),
      'exec',
      '--ephemeral',
      '--skip-git-repo-check',
      '--color',
      'never',
      '-s',
      codexSandboxArg(agentUser?.permissionMode),
    ];
    const model = agentUser?.agentModel?.trim();
    if (model) args.push('--model', model);
    args.push(prompt);
    return { command: 'codex', args };
  }

  const model = agentUser?.agentModel ?? 'claude-sonnet-4-6';
  const perm = permissionModeArg(agentUser?.permissionMode ?? 'ask');
  return {
    command: 'claude',
    args: ['--print', prompt, '--model', model, '--permission-mode', perm],
  };
}

export function commandForAgentCliWithNormalization(
  agentUser: AgentUserRow,
  prompt: string,
): CommandSpec {
  const agentCli = normalizeAgentCli(agentUser.agentCli);
  return commandForAgentCli(agentCli, agentUser, prompt);
}

export function runAgent(
  spec: CommandSpec,
  cwd: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.end();

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(Object.assign(new Error('agent timed out'), { stdout, stderr }));
      } else if (code !== 0) {
        reject(Object.assign(new Error(`agent exited with code ${code}`), { stdout, stderr, code }));
      } else {
        resolve(stdout);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(Object.assign(err, { stdout, stderr }));
    });
  });
}
