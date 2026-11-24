import { describe, expect, test } from 'bun:test';
import { ensureRequiredIndexes, type IndexSpec } from './internal';

function spec(label: string, create: () => Promise<unknown>): IndexSpec {
  return { collection: 'items', label, create };
}

describe('ensureRequiredIndexes', () => {
  test('continues checking every index and reports all failures', async () => {
    const failures: string[] = [];
    const error = await ensureRequiredIndexes(
      [
        spec('unique-a', async () => { throw new Error('index a failed'); }),
        spec('unique-b', async () => {}),
        spec('ttl-c', async () => { throw new Error('index c failed'); }),
      ],
      (_error, failed) => failures.push(failed.label),
    ).catch((caught: unknown) => caught);

    expect(failures).toEqual(['unique-a', 'ttl-c']);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('items.unique-a');
    expect((error as Error).message).toContain('items.ttl-c');
  });

  test('resolves when every required index exists', async () => {
    let created = 0;
    await expect(ensureRequiredIndexes([
      spec('a', async () => { created += 1; }),
      spec('b', async () => { created += 1; }),
    ])).resolves.toBeUndefined();
    expect(created).toBe(2);
  });
});
