import { Bell, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { QueryState } from '@/components/feedback';
import { Button, Card, EmptyState, PageHeader, Pagination, Tabs, useToast } from '@/components/ui';
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from '../api';
import { NotificationItem } from '../components/NotificationItem';
import { NotificationPreferencesCard } from '../components/NotificationPreferencesCard';

/** Shared by every role: mount it at /<role>/notifications. */
export default function NotificationsPage() {
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(1);
  const query = useNotifications({ page, unreadOnly: filter === 'unread' });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const toast = useToast();
  const unread = query.data?.meta.unread ?? 0;
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Everything FoodBridge has told you, newest first."
        actions={
          <Button
            variant="outline"
            disabled={unread === 0}
            loading={markAll.isPending}
            leftIcon={<CheckCheck className="size-4" aria-hidden="true" />}
            onClick={() => markAll.mutate(undefined, { onSuccess: (r) => toast.success(`${r.updated} marked as read`), onError: (e) => toast.error(e) })}
          >
            Mark all read
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <div className="px-5 pt-3">
            <Tabs
              label="Notification filter"
              value={filter}
              onChange={(v) => {
                setFilter(v);
                setPage(1);
              }}
              items={[
                { value: 'all', label: 'All' },
                { value: 'unread', label: 'Unread', count: unread },
              ]}
            />
          </div>
          <div className="p-2 sm:p-3">
            <QueryState
              query={query}
              isEmpty={(d) => d.items.length === 0}
              empty={<EmptyState icon={<Bell className="size-6" aria-hidden="true" />} title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'} />}
            >
              {(data) => (
                <>
                  <ul className="divide-y divide-white/5 overflow-hidden rounded-xl">
                    {data.items.map((n) => (
                      <li key={n.id}>
                        <NotificationItem n={n} onRead={(id) => markRead.mutate(id, { onError: (e) => toast.error(e) })} />
                      </li>
                    ))}
                  </ul>
                  <Pagination className="px-3 pt-4 pb-2" page={data.meta.page} pageSize={data.meta.pageSize} total={data.meta.total} onPageChange={setPage} />
                </>
              )}
            </QueryState>
          </div>
        </Card>
        <NotificationPreferencesCard />
      </div>
    </>
  );
}
