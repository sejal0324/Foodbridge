import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ErrorState, SkeletonList } from '@/components/ui';

export interface QueryStateProps<T> {
  query: Pick<UseQueryResult<T>, 'data' | 'error' | 'isPending' | 'isError' | 'refetch'>;
  children: (data: T) => ReactNode;
  loading?: ReactNode;
  empty?: ReactNode;
  isEmpty?: (data: T) => boolean;
  errorTitle?: string;
  compact?: boolean;
}

/** Renders loading, error (with retry and requestId), empty, or the data. */
export function QueryState<T>({ query, children, loading, empty, isEmpty, errorTitle, compact }: QueryStateProps<T>) {
  if (query.isPending) return <>{loading ?? <SkeletonList rows={3} />}</>;
  if (query.isError) return <ErrorState error={query.error} title={errorTitle} onRetry={() => void query.refetch()} compact={compact} />;
  const data = query.data as T;
  if (empty && (isEmpty ? isEmpty(data) : Array.isArray(data) && data.length === 0)) return <>{empty}</>;
  return <>{children(data)}</>;
}
