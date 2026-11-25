import { Check, Eye, EyeOff, X } from 'lucide-react';
import { useState } from 'react';
import { Input, type InputProps } from '@/components/ui/Input';
import { cn } from '@/utils/cn';

/** Password field with a show/hide toggle. */
export function PasswordInput(props: InputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? 'text' : 'password'} className={cn('pr-10', props.className)} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-lg text-slate-400 hover:text-white focus-visible:outline-2 focus-visible:outline-brand-400"
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
      >
        {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
      </button>
    </div>
  );
}

/** Live checklist of the backend password policy. */
export function PasswordPolicy({ value }: { value: string }) {
  const rules = [
    { ok: value.length >= 10, label: 'At least 10 characters' },
    { ok: /[A-Za-z]/.test(value), label: 'A letter' },
    { ok: /[0-9]/.test(value), label: 'A digit' },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Password requirements">
      {rules.map((r) => (
        <li key={r.label} className={cn('flex items-center gap-1', r.ok ? 'text-emerald-300' : 'text-slate-400')}>
          {r.ok ? <Check className="size-3.5" aria-hidden="true" /> : <X className="size-3.5" aria-hidden="true" />}
          {r.label}
          <span className="sr-only">{r.ok ? '(met)' : '(not met)'}</span>
        </li>
      ))}
    </ul>
  );
}
