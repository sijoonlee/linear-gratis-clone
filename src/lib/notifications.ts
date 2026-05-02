export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export type Notification = {
  id: string;
  title: string;
  body?: string;
  type: NotificationType;
  read: boolean;
  createdAt: string;
};

// Module-level store — lives as long as the Node.js process
const store: Notification[] = [];
const subscribers = new Set<(n: Notification) => void>();

export function subscribe(fn: (n: Notification) => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function getNotifications(): Notification[] {
  return [...store].reverse();
}

export function addNotification(title: string, body?: string, type: NotificationType = 'info'): Notification {
  const n: Notification = {
    id: crypto.randomUUID(),
    title,
    body,
    type,
    read: false,
    createdAt: new Date().toISOString(),
  };
  store.push(n);
  subscribers.forEach(fn => fn(n));
  return n;
}

export function markAllRead() {
  store.forEach(n => { n.read = true; });
}

export function clearAll() {
  store.length = 0;
}
