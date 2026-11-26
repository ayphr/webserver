import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { clearAccountQueryCache } from './cacheLifecycle';

describe('cacheLifecycle', () => {
  test('clearAccountQueryCache removes cached queries', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['bootstrap'], { user: { uuid: 'a' } });
    await clearAccountQueryCache(qc);
    expect(qc.getQueryData(['bootstrap'])).toBeUndefined();
  });
});
