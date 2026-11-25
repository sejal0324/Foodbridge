/**
 * Optional desktop notifications. Permission is requested only from a user
 * gesture (a button click); alerts are shown only while the tab is hidden.
 */
export function browserNotificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function browserNotificationPermission(): NotificationPermission | 'unsupported' {
  return browserNotificationsSupported() ? Notification.permission : 'unsupported';
}

export async function requestBrowserNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!browserNotificationsSupported()) return 'unsupported';
  return Notification.requestPermission();
}

export function showBrowserNotification(title: string, body: string, onClick?: () => void): void {
  if (!browserNotificationsSupported() || Notification.permission !== 'granted' || !document.hidden) return;
  try {
    const n = new Notification(title, { body, tag: `fb-${title}`, icon: '/favicon.svg' });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    // Some browsers only allow notifications from a service worker; ignore.
  }
}
