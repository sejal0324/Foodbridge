import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type * as MapModule from '@/components/map';
import { ApiError } from '@/services/apiError';
import { authValue, donorUser, renderWithProviders } from '../../../tests/utils';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import { passwordSchema, toRegisterInput } from './schemas';

vi.mock('@/components/map', async (importOriginal) => ({
  ...(await importOriginal<typeof MapModule>()),
  LocationPicker: () => <div data-testid="location-picker" />,
  MapView: () => null,
}));

describe('password policy (mirrors the backend)', () => {
  it.each([
    ['short1', 'Use at least 10 characters'],
    ['abcdefghijk', 'Include at least one digit'],
    ['12345678901', 'Include at least one letter'],
  ])('rejects %s', (value, message) => {
    const r = passwordSchema.safeParse(value);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toContain(message);
  });
  it('accepts 10+ characters with a letter and a digit', () => {
    expect(passwordSchema.safeParse('Demo-pass-2026').success).toBe(true);
  });
});

describe('LoginPage', () => {
  it('validates on the client before calling the API', async () => {
    const user = userEvent.setup();
    const auth = authValue({ status: 'anonymous', user: null });
    renderWithProviders(<LoginPage />, { auth, route: '/login' });
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email address')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Email/), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('shows the backend message for wrong credentials', async () => {
    const user = userEvent.setup();
    const auth = authValue({ status: 'anonymous', user: null, login: vi.fn().mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.')) });
    renderWithProviders(<LoginPage />, { auth, route: '/login' });
    await user.type(screen.getByLabelText(/Email/), 'spice.garden@demo.foodbridge.local');
    await user.type(screen.getByLabelText(/^Password/), 'wrong-pass-1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
    expect(auth.login).toHaveBeenCalledWith('spice.garden@demo.foodbridge.local', 'wrong-pass-1');
  });

  it('maps 422 validation details onto the matching field', async () => {
    const user = userEvent.setup();
    const err = new ApiError(422, 'VALIDATION_ERROR', 'The request is invalid.', [{ path: 'email', message: 'invalid email address' }]);
    const auth = authValue({ status: 'anonymous', user: null, login: vi.fn().mockRejectedValue(err) });
    renderWithProviders(<LoginPage />, { auth, route: '/login' });
    await user.type(screen.getByLabelText(/Email/), 'a@b.co');
    await user.type(screen.getByLabelText(/^Password/), 'whatever');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid email address')).toBeInTheDocument();
    expect(screen.getByLabelText(/Email/)).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('RegisterPage', () => {
  async function fillValid(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/Full name/), 'Meera Shah');
    await user.type(screen.getByLabelText(/^Email/), 'meera@example.com');
    await user.type(screen.getByLabelText(/^Password\*?$/), 'Strong-pass-2026');
    await user.type(screen.getByLabelText(/Confirm password/), 'Strong-pass-2026');
    await user.type(screen.getByLabelText(/Business name/), 'Meera Kitchens');
  }

  it('enforces the password policy and matching confirmation', async () => {
    const user = userEvent.setup();
    const auth = authValue({ status: 'anonymous', user: null });
    renderWithProviders(<RegisterPage />, { auth, route: '/register' });
    await user.type(screen.getByLabelText(/^Password\*?$/), 'short1');
    await user.type(screen.getByLabelText(/Confirm password/), 'different');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Use at least 10 characters')).toBeInTheDocument();
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    expect(screen.getByText('Enter your full name')).toBeInTheDocument();
    expect(auth.register).not.toHaveBeenCalled();
  });

  it('sends the nested backend shape for a donor', async () => {
    const user = userEvent.setup();
    const auth = authValue({ status: 'anonymous', user: null, register: vi.fn().mockResolvedValue(donorUser) });
    renderWithProviders(<RegisterPage />, { auth, route: '/register' });
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(auth.register).toHaveBeenCalledTimes(1));
    expect(auth.register).toHaveBeenCalledWith({
      accountType: 'DONOR',
      email: 'meera@example.com',
      password: 'Strong-pass-2026',
      fullName: 'Meera Shah',
      phone: undefined,
      organization: { name: 'Meera Kitchens', businessType: 'RESTAURANT', licenseNumber: undefined, addressLine: undefined, city: undefined, state: undefined, postalCode: undefined, location: undefined },
    });
  });

  it('maps server errors onto fields: 422 organization.name and 409 EMAIL_TAKEN', async () => {
    const user = userEvent.setup();
    const register = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(422, 'VALIDATION_ERROR', 'The request is invalid.', [{ path: 'organization.name', message: 'name is reserved' }]))
      .mockRejectedValueOnce(new ApiError(409, 'EMAIL_TAKEN', 'An account with this email already exists.'));
    renderWithProviders(<RegisterPage />, { auth: authValue({ status: 'anonymous', user: null, register }), route: '/register' });
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Name is reserved')).toBeInTheDocument();
    expect(screen.getByLabelText(/Business name/)).toHaveAttribute('aria-invalid', 'true');

    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('An account with this email already exists.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Email/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('offers all 28 states and 8 union territories, and maps LOCATION_OUTSIDE_INDIA to the location', async () => {
    const user = userEvent.setup();
    const register = vi.fn().mockRejectedValue(new ApiError(422, 'LOCATION_OUTSIDE_INDIA', 'FoodBridge operates in India: choose a location in India.'));
    renderWithProviders(<RegisterPage />, { auth: authValue({ status: 'anonymous', user: null, register }), route: '/register' });
    const state = screen.getByLabelText(/State \/ union territory/) as HTMLSelectElement;
    expect(state.querySelectorAll('optgroup[label="States"] option')).toHaveLength(28);
    expect(state.querySelectorAll('optgroup[label="Union territories"] option')).toHaveLength(8);
    await user.selectOptions(state, 'Tamil Nadu');
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('FoodBridge operates in India: choose a location in India.')).toBeInTheDocument();
    expect(register.mock.calls[0]?.[0].organization.state).toBe('Tamil Nadu');
  });

  it('switches to NGO fields and omits donor-only fields', () => {
    const input = toRegisterInput({
      accountType: 'NGO',
      fullName: 'Asha',
      email: 'ASHA@Example.com ',
      phone: '',
      password: 'Strong-pass-2026',
      confirmPassword: 'Strong-pass-2026',
      organizationName: 'Roti Bank',
      businessType: 'RESTAURANT',
      licenseNumber: 'L1',
      registrationNumber: 'NGO-12',
      addressLine: '',
      city: 'Pune',
      state: '',
      postalCode: '',
      location: { lat: 18.5, lng: 73.8 },
    });
    expect(input).toEqual({
      accountType: 'NGO',
      email: 'asha@example.com',
      password: 'Strong-pass-2026',
      fullName: 'Asha',
      phone: undefined,
      organization: { name: 'Roti Bank', registrationNumber: 'NGO-12', addressLine: undefined, city: 'Pune', state: undefined, postalCode: undefined, location: { lat: 18.5, lng: 73.8 } },
    });
  });
});
