import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router';
import { Banner, Button, Field, Input } from '@/components/ui';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { AuthCard } from '@/layouts/AuthLayout';
import { applyServerErrors } from '@/utils/formErrors';
import { homePathFor, useAuth } from '../auth-context';
import { PasswordInput } from '../components/PasswordInput';
import { loginSchema, type LoginValues } from '../schemas';

export default function LoginPage() {
  useDocumentTitle('Sign in');
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const user = await login(values.email, values.password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from.startsWith(homePathFor(user)) ? from : homePathFor(user), { replace: true });
    } catch (err) {
      setFormError(applyServerErrors(err, setError, { fields: ['email', 'password'] }));
    }
  });

  return (
    <AuthCard title="Sign in to FoodBridge" description="Donors, NGOs and administrators sign in here.">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError ? (
          <Banner tone="danger" live>
            {formError}
          </Banner>
        ) : null}
        <Field label="Email" error={errors.email?.message} required>
          <Input type="email" autoComplete="email" inputMode="email" {...register('email')} />
        </Field>
        <Field label="Password" error={errors.password?.message} required>
          <PasswordInput autoComplete="current-password" {...register('password')} />
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm text-brand-300 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" loading={isSubmitting} fullWidth size="lg">
          Sign in
        </Button>
        <p className="text-center text-sm text-slate-400">
          New to FoodBridge?{' '}
          <Link to="/register" className="font-medium text-brand-300 hover:underline">
            Create an account
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
