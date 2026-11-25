import { Bell, CheckCheck } from 'lucide-react';
import { Link } from 'react-router';
import { Button, EmptyState, ErrorState, Popover, SkeletonList, useToast } from '@/components/ui';
import { cn } from '@/utils/cn';
import { useMarkAllNotificationsRead, useMarkNotificationRead, useUnreadNotifications } from '../api';
import { NotificationItem } from './NotificationItem';

/** Top-bar bell: unread count, latest unread items, mark one/all as read. */
export function NotificationBell({ allHref }: { allHref: string }) {
  const unread = useUnreadNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const toast = useToast();
  const count = unread.data?.meta.unread ?? unread.data?.meta.total ?? 0;
  const label = count > 0 ? `Notifications, ${count} unread` : 'Notifications';

  return (
    <Popover
      label="Notifications"
      className="w-[min(92vw,24rem)]"
      trigger={(props) => (
        <Button variant="ghost" size="icon" aria-label={label} {...props} className="relative">
          <Bell className="size-5" aria-hidden="true" />
          {count > 0 ? (
            <span className="absolute top-1.5 right-1.5 grid min-w-4 place-items-center rounded-full bg-brand-500 px-1 text-[10px] leading-4 font-bold text-white tabular-nums" aria-hidden="true">
              {count > 99 ? '99+' : count}
            </span>
          ) : null}
        </Button>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
            <p className="text-sm font-semibold text-white">Notifications</p>
            <Button
              variant="ghost"
              size="sm"
              disabled={count === 0}
              loading={markAll.isPending}
              leftIcon={<CheckCheck className="size-4" aria-hidden="true" />}
              onClick={() => markAll.mutate(undefined, { onError: (e) => toast.error(e) })}
            >
              Mark all read
            </Button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {unread.isPending ? (
              <SkeletonList rows={3} className="p-3" />
            ) : unread.isError ? (
              <ErrorState error={unread.error} compact onRetry={() => void unread.refetch()} />
            ) : unread.data.items.length === 0 ? (
              <EmptyState compact title="You're all caught up" description="New alerts about requests, pickups and rewards appear here." icon={<Bell className="size-5" aria-hidden="true" />} />
            ) : (
              <ul className="divide-y divide-white/5">
                {unread.data.items.map((n) => (
                  <li key={n.id}>
                    <NotificationItem n={n} compact onRead={(id) => markRead.mutate(id, { onError: (e) => toast.error(e) })} onNavigate={close} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={cn('border-t border-white/10 px-4 py-2.5 text-center')}>
            <Link to={allHref} onClick={close} className="text-sm font-medium text-brand-300 hover:underline">
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </Popover>
  );
}
