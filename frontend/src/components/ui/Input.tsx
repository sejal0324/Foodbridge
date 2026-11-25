import type { InputHTMLAttributes, Ref, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/utils/cn';
import { useFieldControl } from './field-context';

export const controlClasses =
  'w-full rounded-lg border border-white/10 bg-surface-raised px-3 text-sm text-white placeholder:text-slate-500 ' +
  'transition-colors hover:border-white/20 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30 ' +
  'disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-red-400/70 aria-[invalid=true]:focus:ring-red-400/30';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>;
}

export function Input({ className, ...props }: InputProps) {
  const a11y = useFieldControl(props);
  return <input {...props} {...a11y} className={cn(controlClasses, 'h-10', className)} />;
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ className, rows = 3, ...props }: TextareaProps) {
  const a11y = useFieldControl(props);
  return <textarea rows={rows} {...props} {...a11y} className={cn(controlClasses, 'py-2 leading-relaxed', className)} />;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  ref?: Ref<HTMLSelectElement>;
  options?: { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
}

export function Select({ className, options, placeholder, children, ...props }: SelectProps) {
  const a11y = useFieldControl(props);
  return (
    <select {...props} {...a11y} className={cn(controlClasses, 'h-10 appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-9', selectChevron, className)}>
      {placeholder !== undefined ? (
        <option value="" disabled>
          {placeholder}
        </option>
      ) : null}
      {options?.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
      {children}
    </select>
  );
}

const selectChevron =
  "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]";
