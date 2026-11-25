import { zodResolver } from '@hookform/resolvers/zod';
import { MailCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { Banner, Button, Field, Input } from '@/components/ui';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { AuthCard } from '@/layouts/AuthLayout';
import { applyServerErrors } from '@/utils/formErrors';
import { useRequestPasswordReset } from '../api';
import { forgotPasswordSchema, type ForgotPasswordValues } from '../schemas';

export default function ForgotPasswordPage() {
  useDocumentTitle('Reset your password');
  const mutation = useRequestPasswordReset();
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState } = useForm<ForgotPasswordValues>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } });

  const onSubmit = handleSubmit(async ({ email }) => {
    setFormError(null);
    try {
      const res = await mutation.mutateAsync(email);
      setSentMessage(res.message);
    } catch (err) {
      setFormError(applyServerErrors(err, setError, { fields: ['email'] }));
    }
  });

  if (sentMessage) {
    return (
      <AuthCard title="Check your email">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-brand-600/15 text-brand-300">
            <MailCheck className="size-6" aria-hidden="true" />
          </div>
          <p className="text-sm text-slate-300" role="status">
            {sentMessage}
          </p>
          <p className="text-xs text-slate-500">The link expires after a short time. If nothing arrives, check spam or try again.</p>
          <Link to="/login" className="text-sm font-medium text-brand-300 hover:underline">
            Back to sign in
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Forgot your password?" description="Enter your account email and we will send you a reset link.">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError ? (
          <Banner tone="danger" live>
            {formError}
          </Banner>
        ) : null}
        <Field label="Email" error={formState.errors.email?.message} required>
          <Input type="email" autoComplete="email" {...register('email')} />
        </Field>
        <Button type="submit" loading={formState.isSubmitting} fullWidth>
          Send reset link
        </Button>
        <Link to="/login" className="text-center text-sm text-slate-400 hover:text-white">
          Back to sign in
        </Link>
      </form>
    </AuthCard>
  );
}
