import { describe, expect, test } from 'bun:test';
import { validateAppealText } from './punishments';

describe('appeal text validation', () => {
  test('requires non-empty text', () => {
    expect(validateAppealText('')).toBe('Appeal text is required');
  });

  test('bounds appeal length', () => {
    expect(validateAppealText('a'.repeat(5000))).toBeNull();
    expect(validateAppealText('a'.repeat(5001))).toContain('5000 characters or fewer');
  });
});
