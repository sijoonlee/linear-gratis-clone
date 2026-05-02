'use client';

import { useEffect, useState } from 'react';
import { Bell, Bot } from 'lucide-react';
import {
  AGENT_CLI_OPTIONS,
  AGENT_CLI_SETTING_KEY,
  DEFAULT_AGENT_CLI,
  normalizeAgentCli,
  type AgentCli,
} from '@/lib/agent-cli';

const AUTO_EXPAND_NOTIFICATIONS_KEY = 'auto-expand-notifications';

export default function SettingsPage() {
  const [autoExpandNotifications, setAutoExpandNotifications] = useState(true);
  const [agentCli, setAgentCli] = useState<AgentCli>(DEFAULT_AGENT_CLI);

  useEffect(() => {
    setAutoExpandNotifications(localStorage.getItem(AUTO_EXPAND_NOTIFICATIONS_KEY) !== 'false');
    fetch('/api/settings')
      .then(r => r.json() as Promise<{ data: Record<string, string> }>)
      .then(({ data }) => setAgentCli(normalizeAgentCli(data[AGENT_CLI_SETTING_KEY])))
      .catch(() => {});
  }, []);

  function updateAutoExpandNotifications(enabled: boolean) {
    setAutoExpandNotifications(enabled);
    localStorage.setItem(AUTO_EXPAND_NOTIFICATIONS_KEY, String(enabled));
  }

  async function updateAgentCli(value: AgentCli) {
    setAgentCli(value);
    await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: AGENT_CLI_SETTING_KEY, value }),
    });
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-sm font-semibold">Settings</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Workspace preferences</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6 max-w-2xl space-y-8">
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Agent CLI</h2>
            <p className="text-xs text-muted-foreground mt-1">Choose which local coding agent runs schedule tasks and cron conversion.</p>
          </div>

          <div className="rounded-md border border-border bg-background overflow-hidden">
            {AGENT_CLI_OPTIONS.map((option, index) => (
              <label
                key={option.value}
                className={`flex items-center justify-between gap-4 px-4 py-3 cursor-pointer hover:bg-accent/40 transition-colors ${
                  index > 0 ? 'border-t border-border' : ''
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <span className="h-8 w-8 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Bot className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="block text-xs text-muted-foreground mt-0.5">{option.description}</span>
                  </span>
                </span>
                <input
                  type="radio"
                  name="agent-cli"
                  value={option.value}
                  checked={agentCli === option.value}
                  onChange={() => updateAgentCli(option.value)}
                  className="h-4 w-4 shrink-0 accent-primary"
                />
              </label>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Notifications</h2>
            <p className="text-xs text-muted-foreground mt-1">Control how notification details appear in the sidebar.</p>
          </div>

          <label className="flex items-center justify-between gap-4 rounded-md border border-border bg-background px-4 py-3">
            <span className="flex items-center gap-3 min-w-0">
              <span className="h-8 w-8 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Bell className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">Expand on new notification</span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  Open the notification panel automatically when a new notification arrives.
                </span>
              </span>
            </span>
            <input
              type="checkbox"
              checked={autoExpandNotifications}
              onChange={e => updateAutoExpandNotifications(e.target.checked)}
              className="h-4 w-4 shrink-0 accent-primary"
            />
          </label>
        </section>
      </div>
    </div>
  );
}
