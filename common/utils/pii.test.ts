import { describe, expect, it } from 'bun:test';
import { redactPII } from './pii';

describe('redactPII', () => {
  it('still redacts formatted phone numbers', () => {
    expect(redactPII('Call 415-555-0123 for help')).toBe('Call [phone redacted] for help');
  });

  it('preserves device serials that would match the phone pattern', () => {
    const serial = '1234567890';
    expect(redactPII(`Device ${serial} is offline`)).toBe('Device [phone redacted] is offline');
    expect(redactPII(`Device ${serial} is offline`, [serial])).toBe(`Device ${serial} is offline`);
  });

  it('preserves multiple serials while redacting other PII', () => {
    const result = redactPII('Serials 1234567890 and 9876543210; email a@b.com', [
      '1234567890',
      '9876543210',
    ]);
    expect(result).toBe('Serials 1234567890 and 9876543210; email [email redacted]');
  });
});
