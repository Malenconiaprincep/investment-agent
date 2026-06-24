const SEEN_STORAGE_KEY = 'monitor-notify-seen-v1';

export function isBrowserNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isBrowserNotificationSupported()) return 'unsupported';
  return Notification.permission;
}

export async function ensureNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!isBrowserNotificationSupported()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.requestPermission();
}

export function showBrowserNotification(input: {
  title: string;
  body: string;
  tag?: string;
}) {
  if (!isBrowserNotificationSupported()) return;
  if (Notification.permission !== 'granted') return;

  const notification = new Notification(input.title, {
    body: input.body,
    tag: input.tag,
    icon: '/favicon.ico',
  });

  notification.onclick = () => {
    window.focus();
    if (window.location.pathname !== '/monitor') {
      window.location.href = '/monitor';
    }
    notification.close();
  };
}

export function loadSeenMonitorKeys(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = sessionStorage.getItem(SEEN_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

export function saveSeenMonitorKeys(keys: Set<string>) {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify([...keys].slice(-200)));
}

export function monitorNotifyKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}
