import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useToast } from '@/components/ui';
import { useSocketEvent, useSocketStatus } from '@/hooks/useSocket';
import { qk } from '@/services/queryKeys';
import { connectSocket, disconnectSocket } from '@/services/socket';
import { tokenStore } from '@/services/tokenStore';
import type { AppNotification } from '@/types';
import { showBrowserNotification } from './browserNotifications';
import { safeLinkPath } from './links';

/**
 * Keeps the Socket.IO connection open while the app shell is mounted:
 * connects with the current access token, reconnects with the new token after
 * every refresh, and turns `notification:new` into a toast + cache refresh.
 * Notifications are persisted server-side, so unread items are refetched on
 * every (re)connect to cover anything missed while offline.
 */
export function useRealtime(): void {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const status = useSocketStatus();

  useEffect(() => {
    const token = tokenStore.get();
    if (token) connectSocket(token);
    const unsubscribe = tokenStore.subscribe((next) => {
      if (next) connectSocket(next);
      else disconnectSocket();
    });
    return () => {
      unsubscribe();
      disconnectSocket();
    };
  }, []);

  useEffect(() => {
    if (status === 'connected') void qc.invalidateQueries({ queryKey: qk.notifications.all });
  }, [status, qc]);

  useSocketEvent<AppNotification>('notification:new', (n) => {
    // A notification usually means related records changed: refresh what is on screen.
    for (const key of [qk.notifications.all, qk.donations.all, qk.requests.all, qk.allocations.all, qk.pickups.all, qk.assistance.all, qk.rewards.all]) {
      void qc.invalidateQueries({ queryKey: key });
    }
    const link = safeLinkPath(n.linkPath);
    const open = link ? () => navigate(link) : undefined;
    toast.show({ title: n.title, description: n.body, tone: n.priority === 'HIGH' ? 'warning' : 'info', action: open ? { label: 'Open', onClick: open } : undefined });
    showBrowserNotification(n.title, n.body, open);
  });
}
