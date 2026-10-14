import { describe, expect, it } from 'vitest';
import { duplicateField, isIdentityDocument } from './duplicate';
import type { SbgError } from '../lib/sbg';

const err = (code: string, params?: Record<string, unknown>): SbgError => ({ code, status: 409, title: 't', detail: 'A driver with this national ID already exists', retryable: false, params });

describe('which detail is already registered', () => {
  it('reads the field the server named — never the English beside it', () => {
    expect(duplicateField(err('DUPLICATE', { field: 'nationalId', register: 'driver' }))).toBe('nationalId');
    expect(duplicateField(err('DUPLICATE', { field: 'phone' }))).toBe('phone');
    // The same sentence with no field is not guessed at: the screen falls back to the generic note.
    expect(duplicateField(err('DUPLICATE'))).toBeUndefined();
  });

  it('answers nothing for any other refusal, or a field it does not know', () => {
    expect(duplicateField(err('FORBIDDEN', { field: 'phone' }))).toBeUndefined();
    expect(duplicateField(err('DUPLICATE', { field: 'shoeSize' }))).toBeUndefined();
    expect(duplicateField(null)).toBeUndefined();
  });

  it('treats an ID and a licence as identity documents, and a phone or email as a sign-in', () => {
    expect(isIdentityDocument('nationalId')).toBe(true);
    expect(isIdentityDocument('licence')).toBe(true);
    expect(isIdentityDocument('phone')).toBe(false);
    expect(isIdentityDocument('email')).toBe(false);
  });
});
