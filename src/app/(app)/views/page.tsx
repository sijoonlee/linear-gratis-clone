'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Pencil, Plus, Trash2, X, Check } from 'lucide-react';
import { useTeam } from '@/contexts/team-context';

type SavedView = {
  id: string;
  teamId: string | null;
  name: string;
  description: string | null;
  filters: string;
  isShared: boolean;
  createdAt: string;
  updatedAt: string;
};

function queryFromFilters(filters: string) {
  try {
    const parsed = JSON.parse(filters) as { query?: string };
    return parsed.query ?? '';
  } catch {
    return '';
  }
}

function issuesHref(query: string) {
  return query.trim() ? `/issues?query=${encodeURIComponent(query.trim())}` : '/issues';
}

function ViewForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: { name: string; description: string; query: string; isShared: boolean };
  onSave: (data: { name: string; description: string; query: string; isShared: boolean }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [query, setQuery] = useState(initial?.query ?? '');
  const [isShared, setIsShared] = useState(initial?.isShared ?? false);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !query.trim()) return;
    setSaving(true);
    await onSave({
      name: name.trim(),
      description: description.trim(),
      query: query.trim(),
      isShared,
    });
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 px-6 py-4 border-b border-border bg-accent/20">
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="View name..."
        className="w-full bg-background border border-border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground"
      />
      <input
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Optional description"
        className="w-full bg-background border border-border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground"
      />
      <textarea
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder='Example: (priority == "urgent" || priority == "high") && labels.includes("bug")'
        rows={3}
        className="w-full bg-background border border-border rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground resize-none font-mono"
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={isShared}
          onChange={e => setIsShared(e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        Shared view
      </label>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving || !name.trim() || !query.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          <Check className="h-3.5 w-3.5" />
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <X className="h-3.5 w-3.5" />
          Cancel
        </button>
      </div>
    </form>
  );
}

function ViewRow({
  view,
  onUpdated,
  onDeleted,
}: {
  view: SavedView;
  onUpdated: (view: SavedView) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const query = queryFromFilters(view.filters);

  async function handleSave(data: { name: string; description: string; query: string; isShared: boolean }) {
    const res = await fetch(`/api/views/${view.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const { data: updated } = await res.json() as { data: SavedView };
    onUpdated(updated);
    setEditing(false);
  }

  async function handleDelete() {
    await fetch(`/api/views/${view.id}`, { method: 'DELETE' });
    onDeleted(view.id);
  }

  if (editing) {
    return (
      <ViewForm
        initial={{
          name: view.name,
          description: view.description ?? '',
          query,
          isShared: view.isShared,
        }}
        onSave={handleSave}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="flex items-center gap-4 px-6 py-3 hover:bg-accent/40 transition-colors group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{view.name}</p>
          {view.isShared && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">shared</span>}
        </div>
        {view.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{view.description}</p>}
        <p className="text-xs font-mono text-muted-foreground mt-1 truncate">{query}</p>
      </div>
      <Link
        href={issuesHref(query)}
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-primary hover:bg-primary/10 rounded transition-colors"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        Open
      </Link>
      <button
        onClick={() => setEditing(true)}
        className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      {confirmingDelete ? (
        <div className="flex items-center gap-1 text-xs">
          <button onClick={handleDelete} className="text-destructive font-medium hover:underline">Delete</button>
          <button onClick={() => setConfirmingDelete(false)} className="text-muted-foreground hover:text-foreground">Cancel</button>
        </div>
      ) : (
        <button
          onClick={() => setConfirmingDelete(true)}
          className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export default function ViewsPage() {
  const { activeTeam } = useTeam();
  const [views, setViews] = useState<SavedView[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!activeTeam) return;
    setLoading(true);
    const res = await fetch(`/api/views?teamId=${activeTeam.id}`);
    const { data } = await res.json() as { data: SavedView[] };
    setViews(data);
    setLoading(false);
  }, [activeTeam]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(data: { name: string; description: string; query: string; isShared: boolean }) {
    if (!activeTeam) return;
    const res = await fetch('/api/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, teamId: activeTeam.id }),
    });
    const { data: created } = await res.json() as { data: SavedView };
    setViews(prev => [created, ...prev]);
    setCreating(false);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-sm font-semibold">Views</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{activeTeam?.name ?? ''}</p>
        </div>
        <button
          onClick={() => setCreating(c => !c)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New view
        </button>
      </div>

      {creating && (
        <ViewForm onSave={handleCreate} onCancel={() => setCreating(false)} />
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">Loading...</div>
        ) : views.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
            <p className="text-sm">No saved views yet</p>
            <p className="text-xs">Create one from a safe query expression.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {views.map(view => (
              <ViewRow
                key={view.id}
                view={view}
                onUpdated={updated => setViews(prev => prev.map(v => v.id === updated.id ? updated : v))}
                onDeleted={id => setViews(prev => prev.filter(v => v.id !== id))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
