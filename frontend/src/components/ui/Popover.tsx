import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/utils/cn';

export interface PopoverProps {
  /** Renders the trigger; spread `props` onto a <button>. */
  trigger: (props: { 'aria-expanded': boolean; 'aria-controls': string; 'aria-haspopup': 'dialog' | 'menu'; onClick: () => void }, open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
  role?: 'dialog' | 'menu';
  label: string;
}

/** Click-to-open panel (notification dropdown, user menu). Closes on Escape or outside click. */
export function Popover({ trigger, children, align = 'right', className, role = 'dialog', label }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const panelId = `pop${id.replace(/:/g, '')}`;
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        (rootRef.current?.querySelector('[aria-controls]') as HTMLElement | null)?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      {trigger({ 'aria-expanded': open, 'aria-controls': panelId, 'aria-haspopup': role, onClick: () => setOpen((o) => !o) }, open)}
      {open ? (
        <div
          id={panelId}
          role={role}
          aria-label={label}
          className={cn(
            'absolute z-40 mt-2 animate-fade-in rounded-xl border border-white/10 bg-surface-raised shadow-2xl shadow-black/50',
            align === 'right' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
