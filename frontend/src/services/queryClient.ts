import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './apiError';

/** Retries only transient failures (network / 5xx), never 4xx business errors. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  const e = ApiError.from(error);
  if (e.status >= 400 && e.status < 500) return false;
  return failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}
