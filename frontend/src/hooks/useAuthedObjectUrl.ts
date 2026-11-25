import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { apiGetBlob } from '@/services/apiClient';

/**
 * Fetches an authenticated binary (e.g. a representative photo) as a blob and
 * exposes it as an object URL. The URL is revoked when it changes or unmounts.
 */
export function useAuthedObjectUrl(path: string | null, queryKey: readonly unknown[]) {
  const query = useQuery({
    queryKey,
    queryFn: () => apiGetBlob(path as string).then((r) => r.blob),
    enabled: Boolean(path),
    staleTime: 5 * 60_000,
  });
  const url = useMemo(() => (query.data ? URL.createObjectURL(query.data) : null), [query.data]);
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);
  return { url, isLoading: query.isLoading, error: query.error };
}
