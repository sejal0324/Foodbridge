import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router';
import { Banner, Button, ButtonLink, Field } from '@/components/ui';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { AuthCard } from '@/layouts/AuthLayout';
import { applyServerErrors } from '@/utils/formErrors';
import { useResetPassword } from '../api';
import { PasswordInput, PasswordPolicy } from '../components/PasswordInput';
import { newPasswordSchema, type NewPasswordValues } from '../schemas';

export default function ResetPasswordPage() {
  useDocumentTitle('Choose a new password');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const mutation = useResetPassword();
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, setError, control, formState } = useForm<NewPasswordValues>({ resolver: zodResolver(newPasswordSchema), defaultValues: { password: '', confirmPassword: '' } });
  const newPassword = useWatch({ control, name: 'password' });

  if (token.length < 20) {
    return (
      <AuthCard title="Reset link is invalid">
        <Banner tone="danger">This password reset link is missing or incomplete. Request a new one.</Banner>
        <ButtonLink to="/forgot-password" className="mt-4 w-full">
          Request a new link
        </ButtonLink>
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard title="Password updated">
        <div className="flex flex-col items-center gap-4 text-center">
          <CheckCircle2 className="size-10 text-emerald-300" aria-hidden="true" />
          <p className="text-sm text-slate-300" role="status">
            Your password has been changed and other sessions were signed out. Sign in with your new password.
          </p>
          <ButtonLink to="/login" className="w-full">
            Sign in
          </ButtonLink>
        </div>
      </AuthCard>
    );
  }

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await mutation.mutateAsync({ token, password: v.password });
      setDone(true);
    } catch (err) {
      setFormError(applyServerErrors(err, setError, { fields: ['password'] }));
    }
  });

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError ? (
          <Banner tone="danger" live>
            {formError} <Link to="/forgot-password" className="underline">Request a new link</Link>
          </Banner>
        ) : null}
        <Field label="New password" error={formState.errors.password?.message} required>
          <PasswordInput autoComplete="new-password" {...register('password')} />
        </Field>
        <PasswordPolicy value={newPassword ?? ''} />
        <Field label="Confirm new password" error={formState.errors.confirmPassword?.message} required>
          <PasswordInput autoComplete="new-password" {...register('confirmPassword')} />
        </Field>
        <Button type="submit" loading={formState.isSubmitting} fullWidth>
          Update password
        </Button>
      </form>
    </AuthCard>
  );
}
