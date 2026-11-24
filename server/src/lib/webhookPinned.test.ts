import { describe, expect, test } from 'bun:test';
import {
  buildPinnedRequestOptions,
  postToPinnedWebhook,
  resolveWebhookTarget,
  type PinnedRequestOptions,
} from './webhookUrl';

type LookupAddress = { address: string; family: 4 | 6 };

describe('pinned webhook delivery', () => {
  test('returns the validated IP so the connection can be pinned', async () => {
    const resolved = await resolveWebhookTarget(
      'https://hooks.example.com/path?x=1',
      async () => [{ address: '93.184.215.14', family: 4 }],
    );

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.target.address).toBe('93.184.215.14');
    expect(resolved.target.hostname).toBe('hooks.example.com');
    expect(resolved.target.url).toBe('https://hooks.example.com/path?x=1');

    const options = buildPinnedRequestOptions(resolved.target, { 'X-Test': '1' });
    expect(options).toMatchObject({
      protocol: 'https:',
      hostname: '93.184.215.14',
      port: 443,
      method: 'POST',
      servername: 'hooks.example.com',
    });
    expect(options.headers).toMatchObject({ Host: 'hooks.example.com', 'X-Test': '1' });
  });

  test('rejects if any DNS answer is a restricted address', async () => {
    const resolved = await resolveWebhookTarget('https://hooks.example.com/hook', async () => [
      { address: '93.184.215.14', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    expect(resolved.ok).toBe(false);
  });

  test('revalidates at send time and refuses a rebound DNS answer', async () => {
    let lookupCount = 0;
    const lookup = async (): Promise<LookupAddress[]> => {
      lookupCount += 1;
      if (lookupCount === 1) return [{ address: '93.184.215.14', family: 4 }];
      // Same hostname now points at the cloud metadata service.
      return [{ address: '169.254.169.254', family: 4 }];
    };

    const seen: PinnedRequestOptions[] = [];
    const request = async (options: PinnedRequestOptions) => {
      seen.push(options);
      return { status: 200 };
    };

    const first = await postToPinnedWebhook('https://hooks.example.com/hook', '{}', {
      timeoutMs: 100,
      lookup,
      request,
    });
    const second = await postToPinnedWebhook('https://hooks.example.com/hook', '{}', {
      timeoutMs: 100,
      lookup,
      request,
    });

    expect(first).toEqual({ ok: true, status: 200 });
    expect(second.ok).toBe(false);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.hostname).toBe('93.184.215.14');
    expect(lookupCount).toBe(2);
  });

  test('does not follow redirects and treats non-2xx as failure', async () => {
    const result = await postToPinnedWebhook('http://93.184.215.14/hook', '{}', {
      timeoutMs: 100,
      request: async () => ({ status: 302 }),
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(302);
  });
});
