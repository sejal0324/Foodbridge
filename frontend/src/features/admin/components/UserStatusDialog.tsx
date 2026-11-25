import { useState } from 'react';
import { Banner, ConfirmDialog, Field, Textarea, useToast } from '@/components/ui';
import { isApiError } from '@/services/apiError';
import { useSetUserStatus } from '../api';
import type { AdminUser } from '../types';

/**
 * Suspend or reactivate a user account (PATCH /admin/users/:id/status).
 * The backend refuses changes to your own account (422 SELF_STATUS_CHANGE)
 * and to invited accounts (ACCOUNT_INVITED); both are explained in place.
 */
export function UserStatusDialog({ user, status, onClose }: { user: AdminUser; status: 'ACTIVE' | 'SUSPENDED'; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const setStatus = useSetUserStatus();
  const toast = useToast();
  const suspend = status === 'SUSPENDED';

  const confirm = async () => {
    setProblem(null);
    try {
      await setStatus.mutateAsync({ userId: user.id, status, reason: reason.trim() || undefined });
      toast.success(suspend ? 'Account suspended' : 'Account reactivated', suspend ? `${user.email} has been signed out of every device.` : `${user.email} can sign in again.`);
      onClose();
    } catch (err) {
      if (isApiError(err, 'SELF_STATUS_CHANGE')) setProblem('You cannot suspend or reactivate your own account. Ask another administrator if your account needs to change.');
      else if (isApiError(err, 'ACCOUNT_INVITED')) setProblem('This account was invited and has not been activated yet, so its status cannot be changed until the invitation is accepted.');
      else toast.error(err);
    }
  };

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      tone={suspend ? 'danger' : 'primary'}
      title={suspend ? `Suspend ${user.fullName}?` : `Reactivate ${user.fullName}?`}
      description={user.email}
      confirmLabel={suspend ? 'Suspend account' : 'Reactivate account'}
      confirmDisabled={problem !== null}
      loading={setStatus.isPending}
      onConfirm={confirm}
    >
      <div className="space-y-4">
        {suspend ? (
          <Banner tone="warning" title="Signed out immediately">
            Suspending ends all of this user’s sessions straight away and blocks sign-in until the account is reactivated.
            {user.role !== 'ADMIN' ? ' It does not change the organisation’s verification status.' : ''}
          </Banner>
        ) : (
          <p className="text-sm text-slate-300">The user can sign in again. Their organisation’s verification status is unchanged.</p>
        )}
        <Field label="Reason" hint="Optional, recorded in the audit log.">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-autofocus />
        </Field>
        {problem ? (
          <Banner tone="danger" live>
            {problem}
          </Banner>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}
