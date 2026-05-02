export type AgentCli = 'claude' | 'codex';

export type AgentCliOption = {
  value: AgentCli;
  label: string;
  description: string;
};

export const AGENT_CLI_SETTING_KEY = 'agent_cli';
export const DEFAULT_AGENT_CLI: AgentCli = 'claude';

export const AGENT_CLI_OPTIONS: AgentCliOption[] = [
  {
    value: 'claude',
    label: 'Claude CLI',
    description: 'Use Claude Code for cron conversion and scheduled task execution.',
  },
  {
    value: 'codex',
    label: 'Codex CLI',
    description: 'Use Codex exec for cron conversion and scheduled task execution.',
  },
];

export function isAgentCli(value: string | null | undefined): value is AgentCli {
  return value === 'claude' || value === 'codex';
}

export function normalizeAgentCli(value: string | null | undefined): AgentCli {
  return isAgentCli(value) ? value : DEFAULT_AGENT_CLI;
}
