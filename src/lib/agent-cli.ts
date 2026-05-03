export type AgentCli = 'claude' | 'codex';

export function isAgentCli(value: string | null | undefined): value is AgentCli {
  return value === 'claude' || value === 'codex';
}

export function normalizeAgentCli(value: string | null | undefined): AgentCli {
  return isAgentCli(value) ? value : 'claude';
}
