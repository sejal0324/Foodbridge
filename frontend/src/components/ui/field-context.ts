import { createContext, useContext, type AriaAttributes } from 'react';
import { cn } from '@/utils/cn';

interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}

export const FieldContext = createContext<FieldContextValue | null>(null);

/** Inside a <Field>, controls pick up their id, aria-describedby and aria-invalid automatically. */
export function useFieldControl(props: { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: AriaAttributes['aria-invalid']; required?: boolean }) {
  const ctx = useContext(FieldContext);
  return {
    id: props.id ?? ctx?.id,
    'aria-describedby': cn(props['aria-describedby'], ctx?.describedBy) || undefined,
    'aria-invalid': props['aria-invalid'] ?? (ctx?.invalid ? true : undefined),
    required: props.required ?? ctx?.required,
  };
}

