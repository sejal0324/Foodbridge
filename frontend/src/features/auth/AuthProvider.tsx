import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useToast } from '@/components/ui';
import { configureSessionHandlers, refreshSession } from '@/services/apiClient';
import { tokenStore } from '@/services/tokenStore';
import type { Me, SessionResponse } from '@/types';
import { authApi } from './api';
import { AuthContext, type AuthContextValue, type AuthStatus } from './auth-context';
import type { RegisterInput } from './schemas';

/**
 * Holds the signed-in user. On start it restores the session with
 * POST /auth/refresh (httpOnly cookie); the access token lives only in memory.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<Me | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const applySession = useCallback((session: SessionResponse) => {
    tokenStore.set(session.accessToken);
    setUser(session.user);
    setStatus('authenticated');
    return session.user;
  }, []);

  const clearSession = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setStatus('anonymous');
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    configureSessionHandlers({
      onRefreshed: (session) => {
        setUser(session.user);
        setStatus('authenticated');
      },
      onSessionExpired: () => {
        clearSession();
        toast.info('Your session has ended', 'Please sign in again to continue.');
      },
    });
    return () => configureSessionHandlers({});
  }, [clearSession, toast]);

  useEffect(() => {
    let cancelled = false;
    refreshSession()
      .then((session) => {
        if (!cancelled) applySession(session);
      })
      .catch(() => {
        if (!cancelled) {
          tokenStore.clear();
          setStatus('anonymous');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [applySession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      login: async (email, password) => applySession(await authApi.login(email, password)),
      register: async (input: RegisterInput) => applySession(await authApi.register(input)),
      acceptInvite: async (token, password) => applySession(await authApi.acceptInvite(token, password)),
      logout: async () => {
        try {
          await authApi.logout();
        } catch {
          // The local session is cleared regardless; the refresh cookie expires server-side.
        }
        clearSession();
      },
      reloadUser: async () => {
        try {
          const me = await authApi.me();
          setUser(me);
          return me;
        } catch {
          return null;
        }
      },
    }),
    [status, user, applySession, clearSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
