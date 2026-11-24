import { describe, expect, it } from 'bun:test';
import { OrderedTokenBuffer } from './assistantStream';

describe('OrderedTokenBuffer', () => {
  it('assembles indexed tokens in order and ignores duplicates', () => {
    const buffer = new OrderedTokenBuffer();
    expect(buffer.push('world', 1)).toEqual([]);
    expect(buffer.push('Hello ', 0)).toEqual(['Hello ', 'world']);
    expect(buffer.push('world', 1)).toEqual([]);
    expect(buffer.push('!', 2)).toEqual(['!']);
    expect(buffer.pendingCount).toBe(0);
  });

  it('holds a gap until the missing index arrives', () => {
    const buffer = new OrderedTokenBuffer();
    expect(buffer.push('two ', 1)).toEqual([]);
    expect(buffer.push('three', 2)).toEqual([]);
    expect(buffer.push('one ', 0)).toEqual(['one ', 'two ', 'three']);
  });

  it('falls back to arrival order when a token has no index', () => {
    const buffer = new OrderedTokenBuffer();
    expect(buffer.push('a')).toEqual(['a']);
    expect(buffer.push('b', 1)).toEqual(['b']);
    expect(buffer.push('c')).toEqual(['c']);
  });

  it('uses the next expected index for unindexed tokens after a gap', () => {
    const buffer = new OrderedTokenBuffer();
    expect(buffer.push('two', 1)).toEqual([]);
    expect(buffer.push('one ')).toEqual(['one ', 'two']);
  });

  it('ignores stale indexes and treats malformed indexes as unindexed', () => {
    const buffer = new OrderedTokenBuffer();
    expect(buffer.push('a', -1)).toEqual(['a']);
    expect(buffer.push('stale', 0)).toEqual([]);
    expect(buffer.push('b', Number.NaN)).toEqual(['b']);
  });

  it('flushes a buffered tail in index order and resets between streams', () => {
    const buffer = new OrderedTokenBuffer();
    buffer.push('later', 2);
    buffer.push('middle ', 1);
    expect(buffer.flush()).toEqual(['middle ', 'later']);
    expect(buffer.pendingCount).toBe(0);
    expect(buffer.push('fourth ', 3)).toEqual(['fourth ']);
    expect(buffer.push('fifth', 4)).toEqual(['fifth']);
    buffer.reset();
    expect(buffer.push('new ', 0)).toEqual(['new ']);
  });
});
