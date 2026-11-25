import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Banner, Button, Card, CardBody, CardHeader, Field, useToast } from '@/components/ui';
import { useChangePassword } from '@/features/auth/api';
import { PasswordInput, PasswordPolicy } from '@/features/auth/components/PasswordInput';
import { changePasswordSchema, type ChangePasswordValues } from '@/features/auth/schemas';
import { applyServerErrors } from '@/utils/formErrors';

/** POST /auth/change-password. Other sessions are signed out by the server. */
export function ChangePasswordCard() {
  const change = useChangePassword();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({ resolver: zodResolver(changePasswordSchema), defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' } });
  const newPassword = useWatch({ control, name: 'newPassword' });
  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await change.mutateAsync({ currentPassword: v.currentPassword, newPassword: v.newPassword });
      reset();
      toast.success('Password changed', 'Other devices have been signed out.');
    } catch (err) {
      setFormError(applyServerErrors(err, setError, { fields: ['currentPassword', 'newPassword'], codeMap: { INVALID_CREDENTIALS: 'currentPassword' } }));
    }
  });
  return (
    <Card>
      <CardHeader title="Change password" icon={<KeyRound className="size-4" aria-hidden="true" />} />
      <CardBody>
        <form noValidate onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          {formError ? (
            <Banner tone="danger" live>
              {formError}
            </Banner>
          ) : null}
          <Field label="Current password" error={errors.currentPassword?.message} required>
            <PasswordInput autoComplete="current-password" {...register('currentPassword')} />
          </Field>
          <Field label="New password" error={errors.newPassword?.message} required>
            <PasswordInput autoComplete="new-password" {...register('newPassword')} />
          </Field>
          <PasswordPolicy value={newPassword ?? ''} />
          <Field label="Confirm new password" error={errors.confirmPassword?.message} required>
            <PasswordInput autoComplete="new-password" {...register('confirmPassword')} />
          </Field>
          <Button type="submit" loading={isSubmitting}>
            Change password
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
