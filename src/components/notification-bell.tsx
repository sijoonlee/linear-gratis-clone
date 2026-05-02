'use client';

import { useEffect, useState } from 'react';
import { Bell, X, CheckCheck } from 'lucide-react';
import type { Notification } from '@/lib/notifications';

const TYPE_STYLES: Record<string, string> = {
  info:    'bg-blue-500/10 text-blue-500',
  success: 'bg-green-500/10 text-green-500',
  warning: 'bg-yellow-500/10 text-yellow-600',
  error:   'bg-red-500/10 text-red-500',
};

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Load existing notifications on mount
    fetch('/api/notifications')
      .then(r => r.json() as Promise<{ data: Notification[] }>)
      .then(({ data }) => setNotifications(data));

    // Subscribe to new notifications via SSE
    const es = new EventSource('/api/notifications/stream');
    es.onmessage = (e) => {
      const n = JSON.parse(e.data as string) as Notification;
      setNotifications(prev => [n, ...prev]);
    };
    return () => es.close();
  }, []);

  async function handleMarkAllRead() {
    await fetch('/api/notifications/read', { method: 'POST' });
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }

  async function handleClear() {
    await fetch('/api/notifications', { method: 'DELETE' });
    setNotifications([]);
    setOpen(false);
  }

  const unread = notifications.filter(n => !n.read).length;

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen(o => !o); if (!open) handleMarkAllRead(); }}
        className="flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
      >
        <div className="relative">
          <Bell className="h-4 w-4 shrink-0" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-primary text-[8px] font-bold text-primary-foreground flex items-center justify-center">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </div>
        <span className="flex-1 text-left">Notifications</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 right-0 mb-1 bg-popover border border-border rounded-md shadow-lg z-50 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-xs font-semibold">Notifications</span>
              <div className="flex items-center gap-1">
                {notifications.length > 0 && (
                  <button onClick={handleMarkAllRead} title="Mark all read" className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
                    <CheckCheck className="h-3.5 w-3.5" />
                  </button>
                )}
                <button onClick={handleClear} title="Clear all" className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">No notifications</p>
              ) : (
                notifications.map(n => (
                  <div
                    key={n.id}
                    className={`px-3 py-2.5 border-b border-border/50 last:border-0 ${n.read ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-start gap-2">
                      <span className={`mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${TYPE_STYLES[n.type]}`}>
                        {n.type}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium leading-snug">{n.title}</p>
                        {n.body && <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{n.body}</p>}
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">{timeAgo(n.createdAt)}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
