import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '@/services/apiError';
import { cn } from '@/utils/cn';
import { ToastContext, type ToastApi, type ToastOptions, type ToastTone } from './toast-context';

interface ToastItem extends ToastOptions {
  id: string;
  tone: ToastTone;
}

const icons: Record<ToastTone, ReactNode> = {
  success: <CheckCircle2 className="size-5 text-emerald-300" aria-hidden="true" />,
  error: <XCircle className="size-5 text-red-300" aria-hidden="true" />,
  info: <Info className="size-5 text-sky-300" aria-hidden="true" />,
  warning: <AlertTriangle className="size-5 text-amber-300" aria-hidden="true" />,
};

let counter = 0;

/** Toast notifications. Use `useToast()` anywhere below this provider. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const show = useCallback(
    (options: ToastOptions) => {
      counter += 1;
      const id = `t${counter}`;
      const tone = options.tone ?? 'info';
      setToasts((list) => [...list.slice(-4), { ...options, id, tone }]);
      const duration = options.duration ?? (tone === 'error' ? 8000 : 5000);
      if (duration > 0) timers.current.set(id, window.setTimeout(() => dismiss(id), duration));
      return id;
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      success: (title, description) => show({ title, description, tone: 'success' }),
      info: (title, description) => show({ title, description, tone: 'info' }),
      warning: (title, description) => show({ title, description, tone: 'warning' }),
      error: (errorOrTitle, description) => {
        if (typeof errorOrTitle === 'string') return show({ title: errorOrTitle, description, tone: 'error' });
        const e = ApiError.from(errorOrTitle);
        return show({ title: description ?? e.message, description: e.requestId ? `Request ID: ${e.requestId}` : undefined, tone: 'error' });
      },
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" aria-relevant="additions" className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={cn('pointer-events-auto flex w-full max-w-sm animate-slide-up gap-3 rounded-xl border bg-surface-raised p-4 shadow-xl shadow-black/40', t.tone === 'error' ? 'border-red-400/30' : 'border-white/10')}
          >
            <div className="mt-0.5 shrink-0">{icons[t.tone]}</div>
            <div className="min-w-0 flex-1">
              {t.title ? <p className="text-sm font-medium text-white">{t.title}</p> : null}
              {t.description ? <p className="mt-0.5 text-sm break-words text-slate-400">{t.description}</p> : null}
              {t.action ? (
                <button
                  type="button"
                  className="mt-2 text-sm font-medium text-brand-300 hover:underline"
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              ) : null}
            </div>
            <button type="button" onClick={() => dismiss(t.id)} className="shrink-0 rounded p-1 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Dismiss notification">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
