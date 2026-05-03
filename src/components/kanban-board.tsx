'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { PriorityIcon } from '@/components/priority-icon';
import { StatusIcon } from '@/components/status-icon';
import { priorityToNumber } from '@/lib/priority';
import { Plus } from 'lucide-react';

type Label = { id: string; name: string; color: string };

export type KanbanIssue = {
  id: string;
  title: string;
  priority: string;
  estimate: number | null;
  statusId: string;
  statusName: string;
  statusColor: string;
  statusType: string;
  projectName: string | null;
  labels: Label[];
};

export type KanbanStatus = {
  id: string;
  name: string;
  color: string;
  type: string;
};

type KanbanColumn = {
  id: string;
  name: string;
  color: string;
  type: string;
  statusIds: string[];
  defaultStatusId: string;
  showReviewBadge: boolean;
};

const COLUMN_NAMES: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  plan: 'Plan',
  coding_in_process: 'Coding in Process',
  code: 'Code',
  done: 'Done',
  cancelled: 'Cancelled',
};

function reviewLabel(statusName: string, columnName: string) {
  const prefix = `${columnName} - `;
  return statusName.startsWith(prefix) ? statusName.slice(prefix.length) : statusName;
}

function IssueCard({
  issue,
  showReviewBadge,
  columnName,
  onDragStart,
}: {
  issue: KanbanIssue;
  showReviewBadge: boolean;
  columnName: string;
  onDragStart: (id: string) => void;
}) {
  return (
    <div
      draggable
      onDragStart={() => onDragStart(issue.id)}
      className="bg-card border border-border rounded-md p-3 cursor-grab active:cursor-grabbing hover:border-primary/40 transition-colors group"
    >
      <Link href={`/issues/${issue.id}`} onClick={e => e.stopPropagation()}>
        <p className="text-sm mb-2 leading-snug group-hover:text-primary transition-colors">
          {issue.title}
        </p>
      </Link>
      <div className="flex items-center gap-2">
        <PriorityIcon priority={priorityToNumber(issue.priority)} className="w-3 h-3" />
        {showReviewBadge && (
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
            style={{ backgroundColor: `${issue.statusColor}18`, color: issue.statusColor }}
          >
            {reviewLabel(issue.statusName, columnName)}
          </span>
        )}
        {issue.labels.map(l => (
          <span
            key={l.id}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
            style={{ backgroundColor: `${l.color}20`, color: l.color }}
          >
            {l.name}
          </span>
        ))}
        {issue.estimate != null && (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">{issue.estimate}</span>
        )}
      </div>
    </div>
  );
}

function Column({
  column,
  issues,
  onDrop,
  onDragStart,
  onQuickCreate,
  creating,
  onCreatingChange,
}: {
  column: KanbanColumn;
  issues: KanbanIssue[];
  onDrop: (statusId: string) => void;
  onDragStart: (id: string) => void;
  onQuickCreate: (statusId: string, title: string) => Promise<void>;
  creating: boolean;
  onCreatingChange: (creating: boolean) => void;
}) {
  const [over, setOver] = useState(false);
  const [title, setTitle] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await onQuickCreate(column.defaultStatusId, title.trim());
    setTitle('');
    onCreatingChange(false);
  }

  return (
    <div
      className={`flex flex-col w-72 shrink-0 rounded-lg border transition-colors ${
        over ? 'border-primary/40 bg-primary/5' : 'border-border bg-muted/20'
      }`}
      onDragOver={e => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={() => { setOver(false); onDrop(column.defaultStatusId); }}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
        <StatusIcon type={column.type} color={column.color} className="h-3.5 w-3.5" />
        <span className="text-sm font-medium flex-1">{column.name}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{issues.length}</span>
        <button
          onClick={() => onCreatingChange(!creating)}
          className="p-0.5 hover:bg-accent rounded transition-colors text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Cards */}
      <div className="flex-1 p-2 space-y-2 min-h-16">
        {issues.map(issue => (
          <IssueCard
            key={issue.id}
            issue={issue}
            showReviewBadge={column.showReviewBadge}
            columnName={column.name}
            onDragStart={onDragStart}
          />
        ))}
      </div>

      {/* Quick create */}
      {creating && (
        <form onSubmit={handleSubmit} className="p-2 border-t border-border">
          <input
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => e.key === 'Escape' && onCreatingChange(false)}
            placeholder="Issue title…"
            className="w-full text-sm bg-background border border-border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground"
          />
          <div className="flex gap-2 mt-2">
            <button type="submit" className="flex-1 py-1 bg-primary text-primary-foreground rounded text-xs font-medium hover:bg-primary/90 transition-colors">
              Save
            </button>
            <button type="button" onClick={() => onCreatingChange(false)} className="flex-1 py-1 border border-border rounded text-xs hover:bg-accent transition-colors">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export function KanbanBoard({
  statuses,
  issues,
  onStatusChange,
  onCreateIssue,
  creatingStatusId,
  onCreatingStatusChange,
}: {
  statuses: KanbanStatus[];
  issues: KanbanIssue[];
  onStatusChange: (issueId: string, statusId: string) => void;
  onCreateIssue: (statusId: string, title: string) => Promise<void>;
  creatingStatusId: string | null;
  onCreatingStatusChange: (statusId: string | null) => void;
}) {
  const dragging = useRef<string | null>(null);

  function handleDrop(statusId: string) {
    if (dragging.current) {
      onStatusChange(dragging.current, statusId);
      dragging.current = null;
    }
  }

  const columns = statuses.reduce<KanbanColumn[]>((acc, status) => {
    const existing = acc.find(column => column.type === status.type);
    if (existing) {
      existing.statusIds.push(status.id);
      existing.showReviewBadge = true;
      return acc;
    }

    acc.push({
      id: status.type,
      name: COLUMN_NAMES[status.type] ?? status.name,
      color: status.color,
      type: status.type,
      statusIds: [status.id],
      defaultStatusId: status.id,
      showReviewBadge: false,
    });
    return acc;
  }, []);

  const byColumn = columns.reduce<Record<string, KanbanIssue[]>>((acc, column) => {
    const statusIds = new Set(column.statusIds);
    acc[column.id] = issues.filter(issue => statusIds.has(issue.statusId));
    return acc;
  }, {});

  return (
    <div className="flex gap-4 p-4 overflow-x-auto h-full">
      {columns.map(column => (
        <Column
          key={column.id}
          column={column}
          issues={byColumn[column.id] ?? []}
          onDrop={handleDrop}
          onDragStart={id => { dragging.current = id; }}
          onQuickCreate={onCreateIssue}
          creating={creatingStatusId === column.defaultStatusId}
          onCreatingChange={creating => onCreatingStatusChange(creating ? column.defaultStatusId : null)}
        />
      ))}
    </div>
  );
}
