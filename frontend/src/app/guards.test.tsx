import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context';
import type { Me } from '@/types';
import { authValue, donorUser } from '../../tests/utils';
import { GuestOnly, RequireAuth, RequireRole, RoleHomeRedirect } from './guards';

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname}</p>;
}

function renderAt(path: string, auth: AuthContextValue) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<GuestOnly><Where /></GuestOnly>} />
          <Route element={<RequireAuth />}>
            <Route path="/app" element={<RoleHomeRedirect />} />
            <Route path="/donor/*" element={<RequireRole roles={['DONOR']}><Where /></RequireRole>} />
            <Route path="/ngo/*" element={<RequireRole roles={['NGO']}><Where /></RequireRole>} />
            <Route path="/admin/*" element={<RequireRole roles={['ADMIN']}><Where /></RequireRole>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const ngoUser: Me = { ...donorUser, id: 'u-ngo', role: 'NGO', organization: { type: 'NGO', id: 'n1', name: 'Helping Hands', verificationStatus: 'APPROVED' } };
const adminUser: Me = { ...donorUser, id: 'u-admin', role: 'ADMIN', organization: null, adminLevel: 'SUPER' };

describe('route guards', () => {
  it('sends anonymous visitors of protected pages to /login', () => {
    renderAt('/donor/donations', authValue({ status: 'anonymous', user: null }));
    expect(screen.getByTestId('where')).toHaveTextContent('/login');
  });

  it('shows a loader while the session is being restored', () => {
    renderAt('/donor', authValue({ status: 'loading', user: null }));
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
  });

  it('lets a donor into the donor area', () => {
    renderAt('/donor/pickups', authValue());
    expect(screen.getByTestId('where')).toHaveTextContent('/donor/pickups');
  });

  it.each([
    ['DONOR opening /ngo', '/ngo', donorUser, '/donor'],
    ['DONOR opening /admin/users', '/admin/users', donorUser, '/donor'],
    ['NGO opening /donor/donations', '/donor/donations', ngoUser, '/ngo'],
    ['ADMIN opening /donor', '/donor', adminUser, '/admin'],
  ])('redirects %s to their own home', (_label, path, user, home) => {
    renderAt(path, authValue({ user }));
    expect(screen.getByTestId('where')).toHaveTextContent(home);
  });

  it('routes /app to the role home', () => {
    renderAt('/app', authValue({ user: ngoUser }));
    expect(screen.getByTestId('where')).toHaveTextContent('/ngo');
  });

  it('keeps signed-in users away from the login page', () => {
    renderAt('/login', authValue());
    expect(screen.getByTestId('where')).toHaveTextContent('/donor');
  });
});
