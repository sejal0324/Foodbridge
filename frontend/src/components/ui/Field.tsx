import { useId, type ReactNode } from 'react';
import { cn } from '@/utils/cn';
import { FieldContext } from './field-context';

export interface FieldProps {
  label: ReactNode;
  children: ReactNode;
  /** Error message (e.g. from React Hook Form `errors.x?.message`). */
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  id?: string;
  className?: string;
  /** Visually hide the label (it stays available to screen readers). */
  hideLabel?: boolean;
}

/** Label + control + hint + error, wired together for assistive technology. */
export function Field({ label, children, error, hint, required = false, id, className, hideLabel }: FieldProps) {
  const autoId = useId();
  const controlId = id ?? `f${autoId.replace(/:/g, '')}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  return (
    <FieldContext.Provider value={{ id: controlId, describedBy: cn(hintId, errorId) || undefined, invalid: Boolean(error), required }}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        <label htmlFor={controlId} className={cn('text-sm font-medium text-slate-200', hideLabel && 'sr-only')}>
          {label}
          {required ? (
            <span className="ml-0.5 text-red-300" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
        {children}
        {hint && !error ? (
          <p id={hintId} className="text-xs text-slate-400">
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} className="text-xs font-medium text-red-300" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

/** Group of related controls (radio/checkbox sets) with a legend. */
export function FieldSet({ legend, children, error, hint, className }: { legend: ReactNode; children: ReactNode; error?: string; hint?: ReactNode; className?: string }) {
  return (
    <fieldset className={cn('flex flex-col gap-2', className)}>
      <legend className="mb-1 text-sm font-medium text-slate-200">{legend}</legend>
      {children}
      {hint && !error ? <p className="text-xs text-slate-400">{hint}</p> : null}
      {error ? (
        <p className="text-xs font-medium text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
