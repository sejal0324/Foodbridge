import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from '@/services/apiError';

export interface ServerErrorOptions {
  /** Backend issue path → form field name (e.g. { 'organization.name': 'organizationName' }). */
  fieldMap?: Record<string, string>;
  /** Form fields that can display an error. Issues for other paths become the form-level message. */
  fields?: readonly string[];
  /** Business error code → field that should show `error.message` (e.g. { EMAIL_TAKEN: 'email' }). */
  codeMap?: Record<string, string>;
}

function sentenceCase(message: string): string {
  return message.charAt(0).toUpperCase() + message.slice(1);
}

/**
 * Maps a failed request onto a React Hook Form:
 * - 422 VALIDATION_ERROR `details: [{ path, message }]` → field errors;
 * - known business codes (codeMap) → the mapped field;
 * Returns the message to show at form level (null when everything was placed on fields).
 */
export function applyServerErrors<T extends FieldValues>(error: unknown, setError: UseFormSetError<T>, options: ServerErrorOptions = {}): string | null {
  const e = ApiError.from(error);
  const codeField = options.codeMap?.[e.code];
  if (codeField) {
    setError(codeField as Path<T>, { type: 'server', message: e.message }, { shouldFocus: true });
    return null;
  }
  const issues = e.validationIssues;
  if (issues.length === 0) return e.message;

  const unplaced: string[] = [];
  let placed = 0;
  for (const issue of issues) {
    const field = options.fieldMap?.[issue.path] ?? issue.path;
    const displayable = field !== '' && (!options.fields || options.fields.includes(field));
    if (!displayable) {
      unplaced.push(issue.path ? `${issue.path}: ${issue.message}` : issue.message);
      continue;
    }
    setError(field as Path<T>, { type: 'server', message: sentenceCase(issue.message) }, { shouldFocus: placed === 0 });
    placed += 1;
  }
  if (unplaced.length === 0) return null;
  return `${e.message} ${unplaced.map(sentenceCase).join('; ')}`;
}
