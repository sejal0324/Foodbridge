import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, mockApi, renderWithProviders } from '../../../../tests/utils';
import { UsersTable } from '../pages/UsersPage';
import type { AdminUser } from '../types';
import { UserStatusDialog } from './UserStatusDialog';

const me: AdminUser = { id: 'u-admin', email: 'admin@foodbridge.local', fullName: 'Asha Rao', role: 'ADMIN', accountStatus: 'ACTIVE', organizationName: null, lastLoginAt: null, createdAt: '2026-11-01T00:00:00Z' };
const donor: AdminUser = { id: 'u-donor', email: 'kitchen@example.test', fullName: 'Kitchen Owner', role: 'DONOR', accountStatus: 'ACTIVE', organizationName: 'Kitchen', lastLoginAt: null, createdAt: '2026-11-01T00:00:00Z' };
const suspended: AdminUser = { ...donor, id: 'u-susp', email: 'paused@example.test', accountStatus: 'SUSPENDED' };

describe('user status changes', () => {
  let restore: () => void = () => undefined;
  afterEach(() => restore());

  it('offers no suspend action on your own row', () => {
    const onAction = vi.fn();
    renderWithProviders(<UsersTable rows={[me, donor, suspended]} currentUserId="u-admin" onAction={onAction} />);
    expect(screen.getAllByText('Your own account cannot be changed here').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Suspend admin@foodbridge.local' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Suspend kitchen@example.test' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Reactivate paused@example.test' }).length).toBeGreaterThan(0);
  });

  it('explains SELF_STATUS_CHANGE from the server and blocks retrying', async () => {
    const user = userEvent.setup();
    const api = mockApi(() => apiError(422, 'SELF_STATUS_CHANGE', 'You cannot change your own account status.'));
    restore = api.restore;
    const onClose = vi.fn();
    renderWithProviders(<UserStatusDialog user={donor} status="SUSPENDED" onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Suspend account' }));
    expect(await screen.findByText(/You cannot suspend or reactivate your own account/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suspend account' })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('suspends with a reason and says the user is signed out', async () => {
    const user = userEvent.setup();
    const api = mockApi(() => ({ status: 204 }));
    restore = api.restore;
    const onClose = vi.fn();
    renderWithProviders(<UserStatusDialog user={donor} status="SUSPENDED" onClose={onClose} />);
    expect(screen.getByText('Signed out immediately')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Reason/), 'Repeated no-shows');
    await user.click(screen.getByRole('button', { name: 'Suspend account' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.calls.map((c) => `${c.method} ${c.url}`)).toEqual(['PATCH /admin/users/u-donor/status']);
    expect(api.calls[0]?.body).toEqual({ status: 'SUSPENDED', reason: 'Repeated no-shows' });
  });
});
