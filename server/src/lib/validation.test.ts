import { describe, expect, it } from 'bun:test';
import { optionalString, requireJsonObject, ValidationError } from '@common';

describe('validation helpers', () => {
  it('rejects non-object JSON bodies', () => {
    expect(() => requireJsonObject([])).toThrow(ValidationError);
  });

  it('enforces string types and maximum lengths', () => {
    expect(() => optionalString({ username: 123 }, 'username')).toThrow('username must be a string');
    expect(() => optionalString({ username: 'abcdef' }, 'username', { maxLength: 5 })).toThrow('username is too long');
  });

  it('trims optional strings by default', () => {
    expect(optionalString({ username: '  alice  ' }, 'username')).toBe('alice');
  });
});
