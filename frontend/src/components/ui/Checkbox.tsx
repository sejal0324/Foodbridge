import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import { cn } from '@/utils/cn';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  description?: ReactNode;
  error?: string;
  ref?: Ref<HTMLInputElement>;
}

/** Native checkbox with a clickable label, optional description and error. */
export function Checkbox({ label, description, error, className, id, ...props }: CheckboxProps) {
  const autoId = useId();
  const cid = id ?? `cb${autoId.replace(/:/g, '')}`;
  const descId = description ? `${cid}-desc` : undefined;
  const errId = error ? `${cid}-err` : undefined;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-start gap-3">
        <input
          id={cid}
          type="checkbox"
          aria-describedby={cn(descId, errId) || undefined}
          aria-invalid={error ? true : undefined}
          className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-white/30 bg-surface-raised accent-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400"
          {...props}
        />
        <div className="min-w-0">
          <label htmlFor={cid} className="cursor-pointer text-sm font-medium text-slate-100">
            {label}
          </label>
          {description ? (
            <p id={descId} className="mt-0.5 text-xs leading-relaxed text-slate-400">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {error ? (
        <p id={errId} role="alert" className="pl-7 text-xs font-medium text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
}

/** Accessible on/off switch (role="switch"). */
export function Switch({ checked, onChange, label, description, disabled, id }: SwitchProps) {
  const autoId = useId();
  const sid = id ?? `sw${autoId.replace(/:/g, '')}`;
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={sid} className="text-sm font-medium text-slate-100">
          {label}
        </label>
        {description ? <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{description}</p> : null}
      </div>
      <button
        id={sid}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400 disabled:opacity-50',
          checked ? 'bg-brand-600' : 'bg-white/15',
        )}
      >
        <span className={cn('inline-block size-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
      </button>
    </div>
  );
}
