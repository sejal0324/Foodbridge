import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/utils/cn';

export interface TabItem<T extends string = string> {
  value: T;
  label: ReactNode;
  count?: number;
  disabled?: boolean;
}

export interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
  /** Id prefix linking each tab to its panel (`${idPrefix}-panel-${value}`). */
  idPrefix?: string;
}

/** Accessible tab list (arrow keys move between tabs). Render the panel with <TabPanel>. */
export function Tabs<T extends string>({ items, value, onChange, label, className, idPrefix }: TabsProps<T>) {
  const autoId = useId();
  const prefix = idPrefix ?? `tabs${autoId.replace(/:/g, '')}`;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = items.filter((i) => !i.disabled);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const current = enabled.findIndex((i) => i.value === items[index]?.value);
    let next = current;
    if (e.key === 'ArrowRight') next = (current + 1) % enabled.length;
    if (e.key === 'ArrowLeft') next = (current - 1 + enabled.length) % enabled.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = enabled.length - 1;
    const target = enabled[next];
    if (!target) return;
    onChange(target.value);
    refs.current[items.indexOf(target)]?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className={cn('-mx-1 flex gap-1 overflow-x-auto border-b border-white/10 px-1', className)}>
      {items.map((item, i) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${prefix}-tab-${item.value}`}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={`${prefix}-panel-${item.value}`}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-400 disabled:opacity-40',
              selected ? 'border-brand-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200',
            )}
          >
            {item.label}
            {item.count !== undefined ? (
              <span className={cn('rounded-full px-1.5 py-px text-xs', selected ? 'bg-brand-600/30 text-brand-100' : 'bg-white/10 text-slate-300')}>{item.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ value, idPrefix, children, className }: { value: string; idPrefix: string; children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={`${idPrefix}-panel-${value}`} aria-labelledby={`${idPrefix}-tab-${value}`} className={className} tabIndex={0}>
      {children}
    </div>
  );
}
