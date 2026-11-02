import { describe, expect, test } from 'bun:test';
import { isDuplicateKeyError, parsePositiveInt } from './http';

describe('http helpers', () => {
  test('parsePositiveInt returns fallback for null/empty', () => {
    expect(parsePositiveInt(null, 5)).toBe(5);
    expect(parsePositiveInt('', 5)).toBe(5);
  });

  test('parsePositiveInt returns fallback for non-positive/non-integer', () => {
    expect(parsePositiveInt('0', 5)).toBe(5);
    expect(parsePositiveInt('-3', 5)).toBe(5);
    expect(parsePositiveInt('1.5', 5)).toBe(5);
    expect(parsePositiveInt('abc', 5)).toBe(5);
  });

  test('parsePositiveInt returns parsed value for positive integers', () => {
    expect(parsePositiveInt('1', 5)).toBe(1);
    expect(parsePositiveInt('42', 5)).toBe(42);
  });

  test('isDuplicateKeyError detects mongo duplicate key errors', () => {
    expect(isDuplicateKeyError({ code: 11000 })).toBe(true);
    expect(isDuplicateKeyError({ code: 1 })).toBe(false);
    expect(isDuplicateKeyError(null)).toBe(false);
    expect(isDuplicateKeyError('err')).toBe(false);
    expect(isDuplicateKeyError({})).toBe(false);
  });
});