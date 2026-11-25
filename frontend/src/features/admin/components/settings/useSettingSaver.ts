import { useState, type ReactNode } from 'react';
import { useToast } from '@/components/ui';
import { ApiError } from '@/services/apiError';
import { useUpdateSetting } from '../../api';

/**
 * Two-step save for a platform setting: `request(value, summary)` opens the
 * confirmation, `confirm()` sends PUT /admin/settings/:key. Server validation
 * errors are kept in `error` for the form to display.
 */
export function useSettingSaver(key: string, onSaved?: (value: unknown) => void) {
  const update = useUpdateSetting();
  const toast = useToast();
  const [pending, setPending] = useState<{ value: unknown; summary: ReactNode } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const request = (value: unknown, summary: ReactNode) => {
    setError(null);
    setPending({ value, summary });
  };

  const confirm = async () => {
    if (!pending) return;
    try {
      const saved = await update.mutateAsync({ key, value: pending.value });
      toast.success('Setting saved', 'The change is recorded in the audit log.');
      onSaved?.(saved.value);
    } catch (err) {
      setError(ApiError.from(err));
    } finally {
      setPending(null);
    }
  };

  return { key, pending, request, confirm, cancel: () => setPending(null), error, isSaving: update.isPending };
}

export type SettingSaver = ReturnType<typeof useSettingSaver>;
