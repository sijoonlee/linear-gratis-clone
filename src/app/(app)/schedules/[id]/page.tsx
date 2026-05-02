'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Trash2, CalendarClock, CheckCircle2, XCircle, Clock, AlertCircle } from 'lucide-react';
import {
  AGENT_CLI_OPTIONS,
  DEFAULT_AGENT_CLI,
  normalizeAgentCli,
  type AgentCli,
} from '@/lib/agent-cli';

type CronTask = {
  id: string;
  status: string;
  triggeredBy: string;
  scheduledFor: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  output: string | null;
  exitCode: number | null;
  createdAt: string;
};

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
  cronTasks: CronTask[];
};

const MODELS = ['claude-sonnet-4-6', 'claude-opus-4-5', 'claude-haiku-4-5-20251001'];
const PERMISSION_MODES = ['ask', 'auto', 'accept-edits', 'plan'];

function statusBadge(status: string) {
  switch (status) {
    case 'completed': return { icon: CheckCircle2, color: '#26C281', label: 'Completed' };
    case 'failed':    return { icon: XCircle,      color: '#EB5757', label: 'Failed' };
    case 'running':   return { icon: Clock,        color: '#F2C94C', label: 'Running' };
    default:          return { icon: AlertCircle,  color: '#95A2B3', label: 'Pending' };
  }
}

export default function ScheduleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [cronExpression, setCronExpression] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [agentCli, setAgentCli] = useState<AgentCli>(DEFAULT_AGENT_CLI);
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [permissionMode, setPermissionMode] = useState('ask');
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/schedules/${id}`)
      .then(r => r.json() as Promise<{ data: Schedule }>)
      .then(({ data }) => {
        setSchedule(data);
        setName(data.name);
        setPrompt(data.prompt);
        setWorkingDirectory(data.workingDirectory ?? '');
        setCronExpression(data.cronExpression ?? '');
        setEnabled(data.enabled);
        setAgentCli(normalizeAgentCli(data.agentCli));
        setModel(data.model);
        setPermissionMode(data.permissionMode);
        setLoading(false);
      });
  }, [id]);

  async function handleSave() {
    if (!name.trim() || !prompt.trim()) return;
    setSaving(true);
    const res = await fetch(`/api/schedules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        prompt: prompt.trim(),
        workingDirectory: workingDirectory.trim() || null,
        cronExpression: cronExpression.trim() || null,
        enabled,
        agentCli,
        model,
        permissionMode,
      }),
    });
    const { data } = await res.json() as { data: Schedule };
    setSchedule(prev => prev ? { ...prev, ...data } : data);
    setSaving(false);
  }

  function resetDraft() {
    if (!schedule) return;
    setName(schedule.name);
    setPrompt(schedule.prompt);
    setWorkingDirectory(schedule.workingDirectory ?? '');
    setCronExpression(schedule.cronExpression ?? '');
    setEnabled(schedule.enabled);
    setAgentCli(normalizeAgentCli(schedule.agentCli));
    setModel(schedule.model);
    setPermissionMode(schedule.permissionMode);
  }

  async function handleDelete() {
    if (!confirm('Delete this schedule and all its history?')) return;
    await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
    router.push('/schedules');
  }

  if (loading || !schedule) {
    return <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="flex h-full">
      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-3 border-b border-border sticky top-0 bg-background z-10">
          <Link href="/schedules" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" />
            Schedules
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={resetDraft}
              className="px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim() || !prompt.trim()}
              className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={handleDelete} className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
          {/* Name */}
          <textarea
            value={name}
            onChange={e => setName(e.target.value)}
            rows={1}
            className="w-full text-2xl font-semibold bg-transparent outline-none resize-none"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />

          {/* Prompt */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Prompt</p>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={5}
              className="w-full text-sm bg-background border border-border rounded px-3 py-2 outline-none focus:ring-1 focus:ring-primary/50 resize-none text-foreground/80 leading-relaxed"
              placeholder={agentCli === 'claude' ? 'Instructions for Claude…' : 'Instructions for Codex…'}
            />
          </div>

          {/* Working directory */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Working Directory</p>
            <input
              value={workingDirectory}
              onChange={e => setWorkingDirectory(e.target.value)}
              className="w-full text-sm bg-background border border-border rounded px-3 py-1.5 outline-none focus:ring-1 focus:ring-primary/50 font-mono"
              placeholder="Optional; defaults to daemon directory"
            />
          </div>

          {/* Execution history */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
              Execution History · {schedule.cronTasks.length}
            </p>
            {schedule.cronTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground border border-border rounded-lg">
                <CalendarClock className="h-6 w-6 opacity-30" />
                <p className="text-sm">No executions yet</p>
              </div>
            ) : (
              <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
                {schedule.cronTasks.map(task => {
                  const { icon: Icon, color, label } = statusBadge(task.status);
                  const expanded = expandedTask === task.id;
                  return (
                    <div key={task.id}>
                      <button
                        onClick={() => setExpandedTask(expanded ? null : task.id)}
                        className="flex items-center gap-3 w-full px-4 py-2.5 hover:bg-accent/40 transition-colors text-left"
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
                        <span className="text-xs font-medium shrink-0" style={{ color }}>{label}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                          {task.triggeredBy === 'schedule' ? 'Scheduled' : 'Manual'}
                        </span>
                        <span className="text-xs text-muted-foreground flex-1">
                          {new Date(task.scheduledFor ?? task.createdAt).toLocaleString()}
                        </span>
                        {task.exitCode !== null && (
                          <span className="text-xs font-mono text-muted-foreground shrink-0">exit {task.exitCode}</span>
                        )}
                        {task.startedAt && task.finishedAt && (
                          <span className="text-xs text-muted-foreground shrink-0">
                            {Math.round((new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime()) / 1000)}s
                          </span>
                        )}
                      </button>
                      {expanded && task.output && (
                        <pre className="px-4 py-3 text-xs font-mono bg-muted/40 text-foreground/80 whitespace-pre-wrap border-t border-border overflow-x-auto">
                          {task.output}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right sidebar */}
      <div className="w-56 shrink-0 border-l border-border h-full overflow-y-auto p-4 space-y-5">
        {/* Enabled toggle */}
        <div>
          <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Status</p>
          <button
            onClick={() => setEnabled(v => !v)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm w-full transition-colors ${
              enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${enabled ? 'bg-primary' : 'bg-muted-foreground'}`} />
            {enabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>

        <div>
          <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Agent CLI</p>
          <select
            value={agentCli}
            onChange={e => setAgentCli(normalizeAgentCli(e.target.value))}
            className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-primary/50"
          >
            {AGENT_CLI_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>

        {/* Cron expression */}
        <div>
          <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Cron Expression</p>
          <input
            value={cronExpression}
            onChange={e => setCronExpression(e.target.value)}
            placeholder="Manual only"
            className="w-full text-xs font-mono bg-background border border-border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground"
          />
        </div>

        {agentCli === 'claude' && (
          <>
            {/* Model */}
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Model</p>
              <select
                value={model}
                onChange={e => setModel(e.target.value)}
                className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-primary/50"
              >
                {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            {/* Permission mode */}
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Permission Mode</p>
              <select
                value={permissionMode}
                onChange={e => setPermissionMode(e.target.value)}
                className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-primary/50"
              >
                {PERMISSION_MODES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </>
        )}

        {/* Created */}
        <div>
          <p className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wide">Created</p>
          <p className="text-xs text-muted-foreground">{new Date((schedule as unknown as { createdAt: string }).createdAt).toLocaleDateString()}</p>
        </div>
      </div>
    </div>
  );
}
