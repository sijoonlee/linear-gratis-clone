'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useTeam } from '@/contexts/team-context';
import { Plus, CalendarClock, Play, Sparkles } from 'lucide-react';
import {
  AGENT_CLI_OPTIONS,
  AGENT_CLI_SETTING_KEY,
  DEFAULT_AGENT_CLI,
  normalizeAgentCli,
  type AgentCli,
} from '@/lib/agent-cli';

type Schedule = {
  id: string;
  name: string;
  description: string | null;
  prompt: string;
  cronExpression: string | null;
  workingDirectory: string | null;
  agentCli: AgentCli;
  model: string;
  permissionMode: string;
  enabled: boolean;
};

const MODELS = ['claude-sonnet-4-6', 'claude-opus-4-5', 'claude-haiku-4-5-20251001'];
const PERMISSION_MODES = ['ask', 'auto', 'accept-edits', 'plan'];
const CONVERSION_TIMEOUT_MS = 65_000;

async function notify(title: string, body?: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
  await fetch('/api/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, type }),
  }).catch(() => {});
}

export default function SchedulesPage() {
  const { activeTeam } = useTeam();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '',
    prompt: '',
    workingDirectory: '',
    cronExpression: '',
    agentCli: DEFAULT_AGENT_CLI,
    model: 'claude-sonnet-4-6',
    permissionMode: 'ask',
  });
  const [cronDescription, setCronDescription] = useState('');
  const [converting, setConverting] = useState(false);
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [agentCli, setAgentCli] = useState<AgentCli>(DEFAULT_AGENT_CLI);

  const load = useCallback(async () => {
    if (!activeTeam) return;
    setLoading(true);
    const res = await fetch(`/api/schedules?teamId=${activeTeam.id}`);
    const { data } = await res.json() as { data: Schedule[] };
    setSchedules(data);
    setLoading(false);
  }, [activeTeam]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json() as Promise<{ data: Record<string, string> }>)
      .then(({ data }) => {
        const next = normalizeAgentCli(data[AGENT_CLI_SETTING_KEY]);
        setAgentCli(next);
        setForm(f => ({ ...f, agentCli: next }));
      })
      .catch(() => {});
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!activeTeam || !form.name || !form.prompt) return;
    await fetch('/api/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teamId: activeTeam.id,
        name: form.name,
        prompt: form.prompt,
        workingDirectory: form.workingDirectory.trim() || null,
        cronExpression: form.cronExpression || null,
        agentCli: form.agentCli,
        model: form.model,
        permissionMode: form.permissionMode,
      }),
    });
    setForm({ name: '', prompt: '', workingDirectory: '', cronExpression: '', agentCli, model: 'claude-sonnet-4-6', permissionMode: 'ask' });
    setCreating(false);
    load();
  }

  async function runSchedule(s: Schedule) {
    await fetch('/api/cron-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduleId: s.id, status: 'pending' }),
    });
  }

  async function convertCronExpression() {
    if (!cronDescription.trim()) return;
    setConverting(true);
    setConversionError(null);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), CONVERSION_TIMEOUT_MS);

    try {
      const res = await fetch('/api/cron-expression', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: cronDescription }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: undefined })) as { error?: string };
        const message = error ?? `The server returned ${res.status} ${res.statusText || 'without a message'}.`;
        setConversionError(message);
        await notify('Cron expression conversion failed', message, 'error');
        return;
      }
      const { data } = await res.json() as { data: { expression: string } };
      setForm(f => ({ ...f, cronExpression: data.expression }));
    } catch (err: unknown) {
      const message = err instanceof DOMException && err.name === 'AbortError'
        ? 'Cron expression conversion timed out.'
        : err instanceof Error ? err.message : 'Failed to convert cron expression.';
      setConversionError(message);
      await notify('Cron expression conversion failed', message, 'error');
    } finally {
      window.clearTimeout(timeoutId);
      setConverting(false);
    }
  }

  async function toggleEnabled(s: Schedule) {
    await fetch(`/api/schedules/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !s.enabled }),
    });
    setSchedules(prev => prev.map(r => r.id === s.id ? { ...r, enabled: !r.enabled } : r));
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-sm font-semibold">Schedules</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{activeTeam?.name ?? ''}</p>
        </div>
        <button
          onClick={() => setCreating(c => !c)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New schedule
        </button>
      </div>

      {creating && (
        <form onSubmit={handleCreate} className="px-6 py-4 border-b border-border bg-accent/20 space-y-3">
          <input
            autoFocus
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Schedule name…"
            className="w-full bg-background border border-border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground"
          />
          <textarea
            value={form.prompt}
            onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))}
            placeholder={form.agentCli === 'claude' ? 'Instructions for Claude…' : 'Instructions for Codex…'}
            rows={3}
            className="w-full bg-background border border-border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground resize-none"
          />
          <input
            value={form.workingDirectory}
            onChange={e => setForm(f => ({ ...f, workingDirectory: e.target.value }))}
            placeholder="Working directory (optional; defaults to daemon directory)"
            className="w-full bg-background border border-border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground"
          />
          <div>
            <span className="text-xs text-muted-foreground block mb-1">Agent CLI</span>
            <select
              value={form.agentCli}
              onChange={e => setForm(f => ({ ...f, agentCli: normalizeAgentCli(e.target.value) }))}
              className="w-full bg-background border border-border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary/50"
            >
              {AGENT_CLI_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <div className="flex gap-2">
              <input
                value={cronDescription}
                onChange={e => setCronDescription(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); convertCronExpression(); } }}
                placeholder="Describe the schedule (e.g. every weekday at 9am)"
                className="flex-1 bg-background border border-border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={convertCronExpression}
                disabled={converting || !cronDescription.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary rounded text-xs font-medium hover:bg-primary/20 disabled:opacity-50 transition-colors shrink-0"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {converting ? 'Converting…' : 'Convert'}
              </button>
            </div>
            <input
              value={form.cronExpression}
              onChange={e => setForm(f => ({ ...f, cronExpression: e.target.value }))}
              placeholder="Cron expression (e.g. 0 9 * * 1-5) — leave blank for manual"
              className="w-full bg-background border border-border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground font-mono"
            />
            {conversionError && (
              <p className="text-xs text-destructive">{conversionError}</p>
            )}
          </div>
          {form.agentCli === 'claude' ? (
            <div className="flex gap-3">
              <div className="flex-1">
                <span className="text-xs text-muted-foreground block mb-1">Model</span>
                <select
                  value={form.model}
                  onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
                  className="w-full bg-background border border-border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary/50"
                >
                  {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <span className="text-xs text-muted-foreground block mb-1">Permission mode</span>
                <select
                  value={form.permissionMode}
                  onChange={e => setForm(f => ({ ...f, permissionMode: e.target.value }))}
                  className="w-full bg-background border border-border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary/50"
                >
                  {PERMISSION_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
          ) : (
            <div className="rounded border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
              Codex CLI is selected in Settings. Schedules will run with Codex exec using this working directory, or the daemon directory if left blank.
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={!form.name || !form.prompt}
              className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              Save
            </button>
            <button type="button" onClick={() => setCreating(false)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
            {(!form.name || !form.prompt) && (
              <span className="text-xs text-muted-foreground">Name and prompt are required</span>
            )}
          </div>
        </form>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">Loading…</div>
        ) : schedules.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3 text-muted-foreground">
            <CalendarClock className="h-8 w-8 opacity-30" />
            <p className="text-sm">No schedules yet</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {schedules.map(s => (
              <div key={s.id} className="flex items-center gap-4 px-6 py-3 hover:bg-accent/40 transition-colors">
                <button
                  onClick={() => toggleEnabled(s)}
                  title={s.enabled ? 'Disable' : 'Enable'}
                  className={`w-8 h-4 rounded-full transition-colors shrink-0 ${s.enabled ? 'bg-primary' : 'bg-muted'}`}
                >
                  <span className={`block w-3 h-3 rounded-full bg-white shadow transition-transform mx-0.5 ${s.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
                <Link href={`/schedules/${s.id}`} className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{s.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{s.prompt}</p>
                </Link>
                <span className="text-xs font-mono text-muted-foreground shrink-0">
                  {s.cronExpression ?? 'Manual'}
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                  {normalizeAgentCli(s.agentCli) === 'claude' ? s.model.replace('claude-', '').replace(/-\d{8}$/, '') : 'codex'}
                </span>
                <button
                  onClick={() => runSchedule(s)}
                  title="Run now"
                  className="p-1.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors shrink-0"
                >
                  <Play className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
