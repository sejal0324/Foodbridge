import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/apiError';
import { applyServerErrors } from './formErrors';

describe('applyServerErrors', () => {
  it('places each 422 issue on its (mapped) field and returns null when all are placed', () => {
    const setError = vi.fn();
    const err = new ApiError(422, 'VALIDATION_ERROR', 'The request is invalid.', [
      { path: 'organization.name', message: 'too short' },
      { path: 'email', message: 'invalid email' },
    ]);
    const message = applyServerErrors(err, setError, { fieldMap: { 'organization.name': 'organizationName' }, fields: ['organizationName', 'email'] });
    expect(message).toBeNull();
    expect(setError).toHaveBeenCalledWith('organizationName', { type: 'server', message: 'Too short' }, { shouldFocus: true });
    expect(setError).toHaveBeenCalledWith('email', { type: 'server', message: 'Invalid email' }, { shouldFocus: false });
  });

  it('returns a form-level message for issues the form cannot show', () => {
    const setError = vi.fn();
    const err = new ApiError(422, 'VALIDATION_ERROR', 'The request is invalid.', [{ path: 'location.lat', message: 'out of range' }]);
    expect(applyServerErrors(err, setError, { fields: ['foodName'] })).toBe('The request is invalid. Location.lat: out of range');
    expect(setError).not.toHaveBeenCalled();
  });

  it('maps business error codes onto a field', () => {
    const setError = vi.fn();
    const err = new ApiError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
    expect(applyServerErrors(err, setError, { codeMap: { EMAIL_TAKEN: 'email' } })).toBeNull();
    expect(setError).toHaveBeenCalledWith('email', { type: 'server', message: 'An account with this email already exists.' }, { shouldFocus: true });
  });

  it('falls back to the error message for other failures', () => {
    expect(applyServerErrors(new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.'), vi.fn())).toBe('An unexpected error occurred.');
  });
});
