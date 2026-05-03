'use client';

import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';

const AUTO_EXPAND_NOTIFICATIONS_KEY = 'auto-expand-notifications';

export default function SettingsPage() {
  const [autoExpandNotifications, setAutoExpandNotifications] = useState(true);

  useEffect(() => {
    setAutoExpandNotifications(localStorage.getItem(AUTO_EXPAND_NOTIFICATIONS_KEY) !== 'false');
  }, []);

  function updateAutoExpandNotifications(enabled: boolean) {
    setAutoExpandNotifications(enabled);
    localStorage.setItem(AUTO_EXPAND_NOTIFICATIONS_KEY, String(enabled));
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
