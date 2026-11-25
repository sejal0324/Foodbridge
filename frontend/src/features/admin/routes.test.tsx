import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext } from '@/features/auth/auth-context';
import { ADMIN_NAV, NAVIGATION } from '@/layouts/navigation';
import type { Me } from '@/types';
import { authValue, donorUser } from '../../../tests/utils';
import AdminRoutes from './routes';

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

const adminUser: Me = { ...donorUser, id: 'u-admin', email: 'admin@foodbridge.local', role: 'ADMIN', organization: null, adminLevel: 'SUPER' };
const ngoUser: Me = { ...donorUser, id: 'u-ngo', role: 'NGO', organization: { type: 'NGO', id: 'n1', name: 'Helping Hands', verificationStatus: 'APPROVED' } };

function renderAt(path: string, user: Me) {
  return render(
    <AuthContext.Provider value={authValue({ user })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/*" element={<AdminRoutes />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('admin navigation', () => {
  it('lists every admin page under /admin and is the ADMIN navigation', () => {
    expect(NAVIGATION.ADMIN).toBe(ADMIN_NAV);
    const paths = ADMIN_NAV.flatMap((s) => s.items.map((i) => i.to));
    expect(paths).toEqual([
      '/admin',
      '/admin/verifications',
      '/admin/users',
      '/admin/donations',
      '/admin/assistance',
      '/admin/pickups',
      '/admin/disputes',
      '/admin/rewards',
      '/admin/billing',
      '/admin/ai',
      '/admin/settings',
      '/admin/audit',
      '/admin/system',
      '/admin/notifications',
      '/admin/assistant',
      '/admin/account',
    ]);
    expect(ADMIN_NAV[0]?.items[0]?.end).toBe(true);
    expect(ADMIN_NAV.flatMap((s) => s.items).every((i) => !i.requiresApproval && !i.visible)).toBe(true);
  });
});

describe('admin route guard', () => {
  it.each([
    ['a donor', donorUser, '/donor'],
    ['an NGO', ngoUser, '/ngo'],
  ])('sends %s away from /admin/settings to their own home', (_label, user, home) => {
    renderAt('/admin/settings', user);
    expect(screen.getByTestId('where')).toHaveTextContent(home);
  });

  it('lets an admin in (unknown admin paths show the not-found page inside the area)', () => {
    renderAt('/admin/does-not-exist', adminUser);
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.queryByTestId('where')).not.toBeInTheDocument();
  });
});
