import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Banner, ConfirmDialog, Field, Textarea, useToast } from '@/components/ui';
import { applyServerErrors } from '@/utils/formErrors';
import { useDecideVerification } from '../api';
import { ORG_TYPE_LABEL } from '../labels';
import { decisionSchema, type DecisionValues, type VerificationDecision } from '../schemas';
import type { OrgType } from '../types';

const COPY: Record<VerificationDecision, { title: string; confirm: string; done: string }> = {
  APPROVED: { title: 'Approve', confirm: 'Approve organisation', done: 'Organisation approved' },
  REJECTED: { title: 'Reject', confirm: 'Reject application', done: 'Application rejected' },
  SUSPENDED: { title: 'Suspend', confirm: 'Suspend organisation', done: 'Organisation suspended' },
};

export interface DecisionTarget {
  type: OrgType;
  id: string;
  name: string;
}

/**
 * Approve / reject / suspend an organisation (PATCH
 * /admin/organizations/:type/:id/verification). Notes are required to reject;
 * suspending signs the owner out immediately.
 */
export function DecisionDialog({ target, decision, onClose, onDone }: { target: DecisionTarget; decision: VerificationDecision; onClose: () => void; onDone?: () => void }) {
  const decide = useDecideVerification();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<DecisionValues>({ resolver: zodResolver(decisionSchema), defaultValues: { status: decision, notes: '' } });
  const copy = COPY[decision];

  const submit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await decide.mutateAsync({ type: target.type, id: target.id, status: v.status, notes: v.notes || undefined });
      toast.success(copy.done, `${target.name} has been notified.`);
      onClose();
      onDone?.();
    } catch (err) {
      const message = applyServerErrors(err, setError, { fields: ['notes'], codeMap: { REASON_REQUIRED: 'notes' } });
      if (message) setFormError(message);
    }
  });

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      tone={decision === 'APPROVED' ? 'primary' : 'danger'}
      title={`${copy.title} ${target.name}?`}
      description={`${ORG_TYPE_LABEL[target.type]} organisation. The owner is notified by email and in the app.`}
      confirmLabel={copy.confirm}
      loading={decide.isPending}
      onConfirm={() => submit()}
    >
      <div className="space-y-4">
        {decision === 'APPROVED' ? <p className="text-sm text-slate-300">The organisation gets full access: donors can list food and NGOs can request and collect it.</p> : null}
        {decision === 'REJECTED' ? <p className="text-sm text-slate-300">The owner can update their profile or documents and resubmit. Your reason is shown to them.</p> : null}
        {decision === 'SUSPENDED' ? (
          <Banner tone="warning" title="The owner is signed out immediately">
            Suspending ends every session of the organisation’s owner straight away and blocks the organisation from FoodBridge until it is approved again.
          </Banner>
        ) : null}
        <Field
          label={decision === 'REJECTED' ? 'Reason for rejection' : 'Notes'}
          required={decision === 'REJECTED'}
          error={errors.notes?.message}
          hint={decision === 'REJECTED' ? 'Required. Shared with the organisation and recorded in the audit log.' : 'Optional. Shared with the organisation and recorded in the audit log.'}
        >
          <Textarea {...register('notes')} maxLength={1000} rows={4} data-autofocus />
        </Field>
        {formError ? (
          <Banner tone="danger" live>
            {formError}
          </Banner>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}
