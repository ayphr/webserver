import { describe, expect, it } from 'bun:test';
import { buildToolSlotMarkdown, TOOL_SLOT_PREFIX } from './utils';

const slot = (id: string) => `[[${TOOL_SLOT_PREFIX}${id}]]`;

describe('buildToolSlotMarkdown', () => {
  it('returns content untouched when there are no tool slots', () => {
    const content = '# Heading\n\n- one\n- two';
    expect(buildToolSlotMarkdown(content, [])).toBe(content);
  });

  it('inserts slots in offset order, regardless of input order', () => {
    const content = 'Intro\n\nMiddle\n\nTail';
    const result = buildToolSlotMarkdown(content, [
      { id: 'second', offset: 15 },
      { id: 'first', offset: 3 },
    ]);
    expect(result.indexOf(slot('first'))).toBeLessThan(result.indexOf(slot('second')));
    expect(result).toContain('Intro');
    expect(result).toContain('Middle');
    expect(result).toContain('Tail');
  });

  it('keeps fenced code intact and places the slot after the fence', () => {
    const content = 'Before\n\n```ts\nconst x = 1;\n```\n\nAfter';
    const result = buildToolSlotMarkdown(content, [{ id: 'code', offset: content.indexOf('const x') }]);
    expect(result).toContain('```ts\nconst x = 1;\n```');
    expect(result.indexOf(slot('code'))).toBeGreaterThan(result.indexOf('const x = 1;'));
    expect(result.indexOf(slot('code'))).toBeLessThan(result.indexOf('After'));
  });

  it('puts a slot at the end when the offset sits inside a single block', () => {
    const content = 'first line\nsecond line';
    const result = buildToolSlotMarkdown(content, [{ id: 'late', offset: 3 }]);
    expect(result.startsWith(content)).toBe(true);
    expect(result.endsWith(slot('late'))).toBe(true);
  });

  it('ignores duplicate slot ids', () => {
    const result = buildToolSlotMarkdown('One\n\nTwo', [
      { id: 'same', offset: 0 },
      { id: 'same', offset: 5 },
    ]);
    expect(result.split(slot('same')).length - 1).toBe(1);
  });
});
