import { describe, expect, test } from 'bun:test';
import { TQL_REFERENCE } from './reference';
import { validateQuery } from './utils';

function referenceSection(name: string, nextName?: string): string[] {
  const lines = TQL_REFERENCE.split('\n');
  const start = lines.indexOf(name);
  if (start < 0) throw new Error(`Missing reference section: ${name}`);
  const end = nextName ? lines.indexOf(nextName, start + 1) : lines.length;
  return lines.slice(start + 1, end < 0 ? lines.length : end);
}

describe('TQL_REFERENCE', () => {
  test('every example parses', () => {
    const queries = referenceSection('EXAMPLES', 'RULES')
      .map((line) => line.trim())
      .filter(Boolean);

    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) {
      expect(validateQuery(query), query).toEqual({ valid: true });
    }
  });

  test('logic operators match the supported dialect', () => {
    const conditions = referenceSection('CONDITIONS', 'FIELDS AVAILABLE ON EACH POINT').join('\n');
    expect(conditions).toContain('& and | between condition blocks');
    expect(conditions).not.toMatch(/Logic: and \/ & \/ &&/);
    expect(conditions).toContain('"and" is only used inside between');
  });
});
