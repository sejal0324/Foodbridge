import { useSearchParams } from 'react-router';

/**
 * Filter state kept in the URL (shareable, survives reloads and back/forward).
 * Changing any filter resets `page` to 1.
 */
export function useUrlFilters<K extends string>(keys: readonly K[], defaults: Partial<Record<K, string>> = {}) {
  const [params, setParams] = useSearchParams();
  const values = Object.fromEntries(keys.map((k) => [k, params.get(k) ?? defaults[k] ?? ''])) as Record<K, string>;
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  const set = (next: Partial<Record<K, string>> & { page?: number }) => {
    const p = new URLSearchParams(params);
    let filterChanged = false;
    for (const key of keys) {
      if (!(key in next)) continue;
      filterChanged = true;
      const v = next[key];
      if (v === undefined || v === (defaults[key] ?? '')) p.delete(key);
      else p.set(key, v);
    }
    if (next.page !== undefined) {
      if (next.page <= 1) p.delete('page');
      else p.set('page', String(next.page));
    } else if (filterChanged) {
      p.delete('page');
    }
    setParams(p, { replace: true });
  };

  const reset = () => {
    const p = new URLSearchParams(params);
    for (const key of keys) p.delete(key);
    p.delete('page');
    setParams(p, { replace: true });
  };

  const active = keys.some((k) => values[k] !== (defaults[k] ?? ''));
  return { values, page, set, reset, active };
}
