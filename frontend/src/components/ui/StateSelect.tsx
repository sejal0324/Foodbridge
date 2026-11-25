import { INDIAN_STATES, INDIAN_UNION_TERRITORIES, INDIA_STATES_AND_UTS } from '@/utils/india';
import { Select, type SelectProps } from './Input';

/**
 * Indian state / union territory picker (28 states + 8 UTs). A stored value
 * that is not in the official list (`current`) is kept as an extra option.
 */
export function StateSelect({ current, ...props }: Omit<SelectProps, 'options' | 'placeholder' | 'children'> & { current?: string | null }) {
  const legacy = current && !INDIA_STATES_AND_UTS.includes(current) ? current : null;
  return (
    <Select {...props}>
      <option value="">Select a state or union territory</option>
      <optgroup label="States">
        {INDIAN_STATES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </optgroup>
      <optgroup label="Union territories">
        {INDIAN_UNION_TERRITORIES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </optgroup>
      {legacy ? <option value={legacy}>{legacy} (as entered)</option> : null}
    </Select>
  );
}
