import { createContext, useContext } from 'react';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface ToastOptions {
  title?: string;
  description?: string;
  tone?: ToastTone;
  /** ms; 0 keeps it until dismissed. Errors default to 8 s, others to 5 s. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

export interface ToastApi {
  show: (options: ToastOptions) => string;
  success: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  warning: (title: string, description?: string) => string;
  /** Accepts an ApiError (or anything thrown) and shows its user-safe message and requestId. */
  error: (errorOrTitle: unknown, description?: string) => string;
  dismiss: (id: string) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
