import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router';
import { Banner, Button, ButtonLink, Field } from '@/components/ui';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { AuthCard } from '@/layouts/AuthLayout';
import { applyServerErrors } from '@/utils/formErrors';
import { homePathFor, useAuth } from '../auth-context';
import { PasswordInput, PasswordPolicy } from '../components/PasswordInput';
import { newPasswordSchema, type NewPasswordValues } from '../schemas';

/** NGO representatives accept their invitation and set a password. */
export default function AcceptInvitePage() {
  useDocumentTitle('Accept invitation');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { acceptInvite } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, setError, control, formState } = useForm<NewPasswordValues>({ resolver: zodResolver(newPasswordSchema), defaultValues: { password: '', confirmPassword: '' } });
  const newPassword = useWatch({ control, name: 'password' });

  if (token.length < 20) {
    return (
      <AuthCard title="Invitation link is invalid">
        <Banner tone="danger">This invitation link is missing or incomplete. Ask your NGO to send a new invitation.</Banner>
        <ButtonLink to="/login" variant="outline" className="mt-4 w-full">
          Go to sign in
        </ButtonLink>
      </AuthCard>
    );
  }

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      const user = await acceptInvite(token, v.password);
      navigate(homePathFor(user), { replace: true });
    } catch (err) {
      setFormError(applyServerErrors(err, setError, { fields: ['password'] }));
    }
  });

  return (
    <AuthCard title="Join your NGO on FoodBridge" description="You were invited as a pickup representative. Choose a password to activate your account.">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError ? (
          <Banner tone="danger" live>
            {formError}
          </Banner>
        ) : null}
        <Field label="Password" error={formState.errors.password?.message} required>
          <PasswordInput autoComplete="new-password" {...register('password')} />
        </Field>
        <PasswordPolicy value={newPassword ?? ''} />
        <Field label="Confirm password" error={formState.errors.confirmPassword?.message} required>
          <PasswordInput autoComplete="new-password" {...register('confirmPassword')} />
        </Field>
        <Button type="submit" loading={formState.isSubmitting} fullWidth>
          Activate account
        </Button>
      </form>
    </AuthCard>
  );
}
