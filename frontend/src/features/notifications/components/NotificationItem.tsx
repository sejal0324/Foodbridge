import { Check } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui';
import { cn } from '@/utils/cn';
import { formatDateTime, formatRelative } from '@/utils/format';
import type { AppNotification } from '@/types';
import { safeLinkPath } from '../links';

export function NotificationItem({ n, onRead, onNavigate, compact }: { n: AppNotification; onRead?: (id: string) => void; onNavigate?: () => void; compact?: boolean }) {
  const unread = !n.readAt;
  const link = safeLinkPath(n.linkPath);
  const content = (
    <>
      <p className={cn('text-sm', unread ? 'font-semibold text-white' : 'font-medium text-slate-200')}>{n.title}</p>
      <p className={cn('mt-0.5 text-sm text-slate-400', compact && 'line-clamp-2')}>{n.body}</p>
      <time dateTime={n.createdAt} title={formatDateTime(n.createdAt)} className="mt-1 block text-xs text-slate-500">
        {formatRelative(n.createdAt)}
      </time>
    </>
  );
  return (
    <div className={cn('group relative flex gap-3 px-4 py-3', unread && 'bg-brand-600/[0.06]')}>
      <span aria-hidden="true" className={cn('mt-1.5 size-2 shrink-0 rounded-full', unread ? 'bg-brand-400' : 'bg-transparent')} />
      <div className="min-w-0 flex-1">
        {link ? (
          <Link
            to={link}
            onClick={() => {
              if (unread) onRead?.(n.id);
              onNavigate?.();
            }}
            className="block rounded focus-visible:outline-2 focus-visible:outline-brand-400"
          >
            {content}
          </Link>
        ) : (
          content
        )}
      </div>
      {unread && onRead ? (
        <Button variant="ghost" size="icon-sm" onClick={() => onRead(n.id)} aria-label={`Mark "${n.title}" as read`} title="Mark as read">
          <Check className="size-4" aria-hidden="true" />
        </Button>
      ) : null}
      {unread ? <span className="sr-only">Unread</span> : null}
    </div>
  );
}
