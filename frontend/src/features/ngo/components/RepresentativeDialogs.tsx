import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, Copy, Mail, MailX } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Banner, Button, Dialog, Field, Input, Select, useToast } from '@/components/ui';
import { useAuth, useCurrentUser } from '@/features/auth/auth-context';
import { ID_DOCUMENT_LABELS } from '@/utils/labels';
import { applyServerErrors } from '@/utils/formErrors';
import { useCreateRepresentative } from '../api';
import { addSelfSchema, inviteSchema, type AddSelfValues, type InviteValues } from '../schemas';
import { ID_DOCUMENT_TYPES, type RepresentativeCreated } from '../types';
import { copyText } from '../utils';

const ID_OPTIONS = ID_DOCUMENT_TYPES.map((t) => ({ value: t, label: ID_DOCUMENT_LABELS[t] ?? t }));
const LAST4_HINT = 'Only the last 4 characters of the ID are ever entered or stored, never the full number. The donor checks them against the physical ID.';

export function AddSelfDialog({ onClose }: { onClose: () => void }) {
  const user = useCurrentUser();
  const { reloadUser } = useAuth();
  const create = useCreateRepresentative();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AddSelfValues>({ resolver: zodResolver(addSelfSchema), defaultValues: { phone: user.phone ?? '', idDocumentType: 'AADHAAR', idDocumentLast4: '' } });

  const submit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await create.mutateAsync({ self: true, phone: v.phone.trim(), idDocumentType: v.idDocumentType, idDocumentLast4: v.idDocumentLast4.trim() });
      await reloadUser();
      toast.success('You are now a representative', 'You can be assigned to collections and generate pickup passes.');
      onClose();
    } catch (err) {
      setFormError(applyServerErrors(err, setError, { fields: ['phone', 'idDocumentType', 'idDocumentLast4'], codeMap: { ALREADY_REPRESENTATIVE: 'idDocumentLast4' } }));
    }
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add yourself as a representative"
      description="Collect food yourself. Donors verify you with a QR pass and your photo ID."
      dismissible={!isSubmitting}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={isSubmitting}>
            Add me
          </Button>
        </>
      }
    >
      <form noValidate onSubmit={(e) => void submit(e)} className="grid gap-4 sm:grid-cols-2">
        {formError ? (
          <Banner tone="danger" live className="sm:col-span-2">
            {formError}
          </Banner>
        ) : null}
        <Field label="Mobile number" error={errors.phone?.message} hint="International format, e.g. +919876543210" required className="sm:col-span-2">
          <Input type="tel" autoComplete="tel" {...register('phone')} data-autofocus />
        </Field>
        <Field label="Photo ID type" error={errors.idDocumentType?.message} required>
          <Select {...register('idDocumentType')} options={ID_OPTIONS} />
        </Field>
        <Field label="Last 4 characters of the ID" error={errors.idDocumentLast4?.message} required>
          <Input maxLength={4} autoComplete="off" className="font-mono uppercase" {...register('idDocumentLast4')} />
        </Field>
        <p className="text-xs text-slate-400 sm:col-span-2">{LAST4_HINT}</p>
      </form>
    </Dialog>
  );
}

export function InviteDialog({ onClose }: { onClose: () => void }) {
  const create = useCreateRepresentative();
  const [created, setCreated] = useState<RepresentativeCreated | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<InviteValues>({ resolver: zodResolver(inviteSchema), defaultValues: { fullName: '', email: '', phone: '+91', idDocumentType: 'AADHAAR', idDocumentLast4: '' } });

  const submit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      setCreated(await create.mutateAsync({ fullName: v.fullName.trim(), email: v.email.trim().toLowerCase(), phone: v.phone.trim(), idDocumentType: v.idDocumentType, idDocumentLast4: v.idDocumentLast4.trim() }));
    } catch (err) {
      setFormError(applyServerErrors(err, setError, { fields: ['fullName', 'email', 'phone', 'idDocumentType', 'idDocumentLast4'], codeMap: { EMAIL_TAKEN: 'email' } }));
    }
  });

  if (created) return <InviteResult rep={created} onClose={onClose} />;

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Invite a representative"
      description="They get their own login to collect food for your NGO: pickup passes, location sharing and handover confirmation."
      dismissible={!isSubmitting}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={isSubmitting}>
            Create invitation
          </Button>
        </>
      }
    >
      <form noValidate onSubmit={(e) => void submit(e)} className="grid gap-4 sm:grid-cols-2">
        {formError ? (
          <Banner tone="danger" live className="sm:col-span-2">
            {formError}
          </Banner>
        ) : null}
        <Field label="Full name" error={errors.fullName?.message} required>
          <Input autoComplete="off" {...register('fullName')} data-autofocus />
        </Field>
        <Field label="Email" error={errors.email?.message} hint="Their login" required>
          <Input type="email" autoComplete="off" {...register('email')} />
        </Field>
        <Field label="Mobile number" error={errors.phone?.message} hint="International format, e.g. +919876543210" required>
          <Input type="tel" autoComplete="off" {...register('phone')} />
        </Field>
        <div className="hidden sm:block" />
        <Field label="Photo ID type" error={errors.idDocumentType?.message} required>
          <Select {...register('idDocumentType')} options={ID_OPTIONS} />
        </Field>
        <Field label="Last 4 characters of the ID" error={errors.idDocumentLast4?.message} required>
          <Input maxLength={4} autoComplete="off" className="font-mono uppercase" {...register('idDocumentLast4')} />
        </Field>
        <p className="text-xs text-slate-400 sm:col-span-2">{LAST4_HINT}</p>
      </form>
    </Dialog>
  );
}

function InviteResult({ rep, onClose }: { rep: RepresentativeCreated; onClose: () => void }) {
  const toast = useToast();
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Invitation created"
      description={`${rep.fullName} can set a password and sign in with ${rep.email}.`}
      footer={
        <Button onClick={onClose} data-autofocus>
          Done
        </Button>
      }
    >
      <div className="space-y-4">
        {rep.invitationEmailed ? (
          <Banner tone="success" icon={<Mail className="size-5" aria-hidden="true" />} title="Invitation emailed">
            We emailed the link to {rep.email}. You can also share it yourself.
          </Banner>
        ) : (
          <Banner tone="warning" icon={<MailX className="size-5" aria-hidden="true" />} title="The invitation was not emailed">
            Email delivery is not configured on this FoodBridge instance. Send this link to {rep.fullName} yourself, for example by WhatsApp or a text message.
          </Banner>
        )}
        {rep.inviteUrl ? (
          <Field label="Invitation link" hint="Works once and expires after 72 hours. Treat it like a password.">
            <div className="flex gap-2">
              <Input readOnly value={rep.inviteUrl} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <Button
                variant="secondary"
                leftIcon={<Copy className="size-4" aria-hidden="true" />}
                onClick={() =>
                  void copyText(rep.inviteUrl as string).then((ok) =>
                    ok ? toast.success('Link copied') : toast.show({ title: 'Copy failed', description: 'Select the link and copy it manually.', tone: 'warning' }),
                  )
                }
              >
                Copy
              </Button>
            </div>
          </Field>
        ) : null}
        <p className="flex items-center gap-2 text-sm text-slate-300">
          <CheckCircle2 className="size-4 text-brand-300" aria-hidden="true" /> Once they accept, they appear as active and can be assigned to collections.
        </p>
      </div>
    </Dialog>
  );
}
