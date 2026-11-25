import { useMutation } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/services/apiClient';
import type { Me, SessionResponse } from '@/types';
import type { RegisterInput } from './schemas';

const noRefresh = { skipAuthRefresh: true } as const;

export const authApi = {
  login: (email: string, password: string) => apiPost<SessionResponse>('/auth/login', { email, password }, noRefresh),
  register: (input: RegisterInput) => apiPost<SessionResponse>('/auth/register', input, noRefresh),
  acceptInvite: (token: string, password: string) => apiPost<SessionResponse>('/auth/accept-invite', { token, password }, noRefresh),
  logout: () => apiPost('/auth/logout'),
  me: () => apiGet<Me>('/auth/me'),
  requestPasswordReset: (email: string) => apiPost<{ message: string }>('/auth/password-reset/request', { email }, noRefresh),
  resetPassword: (token: string, password: string) => apiPost('/auth/password-reset/confirm', { token, password }, noRefresh),
  changePassword: (currentPassword: string, newPassword: string) => apiPost('/auth/change-password', { currentPassword, newPassword }),
};

export function useRequestPasswordReset() {
  return useMutation({ mutationFn: (email: string) => authApi.requestPasswordReset(email) });
}

export function useResetPassword() {
  return useMutation({ mutationFn: (v: { token: string; password: string }) => authApi.resetPassword(v.token, v.password) });
}

export function useChangePassword() {
  return useMutation({ mutationFn: (v: { currentPassword: string; newPassword: string }) => authApi.changePassword(v.currentPassword, v.newPassword) });
}
