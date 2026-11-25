import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiGetPage, apiPatch, apiPost, apiPut } from '@/services/apiClient';
import { qk } from '@/services/queryKeys';
import type { AppNotification, NotificationPreferences, NotificationPreferencesInput } from '@/types';

export function useNotifications(params: { page: number; pageSize?: number; unreadOnly?: boolean }) {
  const query = { page: params.page, pageSize: params.pageSize ?? 20, unreadOnly: params.unreadOnly ? 'true' : 'false' };
  return useQuery({
    queryKey: qk.notifications.list(query),
    queryFn: () => apiGetPage<AppNotification>('/notifications', query),
    placeholderData: keepPreviousData,
  });
}

/** Latest unread items + unread count (`meta.unread`) for the bell. */
export function useUnreadNotifications(enabled = true) {
  return useQuery({
    queryKey: qk.notifications.unread,
    queryFn: () => apiGetPage<AppNotification>('/notifications', { page: 1, pageSize: 8, unreadOnly: 'true' }),
    enabled,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPatch(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.notifications.all }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<{ updated: number }>('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.notifications.all }),
  });
}

export function useNotificationPreferences() {
  return useQuery({ queryKey: qk.notifications.preferences, queryFn: () => apiGet<NotificationPreferences>('/notifications/preferences') });
}

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NotificationPreferencesInput) => apiPut<NotificationPreferences>('/notifications/preferences', input),
    onSuccess: (data) => qc.setQueryData(qk.notifications.preferences, data),
  });
}
