import { describe, expect, test } from 'bun:test';
import { validateWebhookUrl } from './webhookUrl';

describe('validateWebhookUrl', () => {
  test('accepts a public http(s) literal URL', async () => {
    expect(await validateWebhookUrl(' https://8.8.8.8/hook ')).toEqual({
      ok: true,
      url: 'https://8.8.8.8/hook',
    });
  });

  test('rejects non-http(s) schemes and embedded credentials', async () => {
    expect((await validateWebhookUrl('ftp://8.8.8.8/hook')).ok).toBe(false);
    expect((await validateWebhookUrl('https://user:pass@8.8.8.8/hook')).ok).toBe(false);
  });

  test('rejects loopback, private, link-local and metadata IP literals', async () => {
    const urls = [
      'http://127.0.0.1/hook',
      'http://10.0.0.5/hook',
      'http://192.168.1.10/hook',
      'http://172.16.0.1/hook',
      'http://169.254.169.254/latest/meta-data/',
      'http://0.0.0.0/hook',
      'http://224.0.0.1/hook',
    ];
    for (const url of urls) {
      expect((await validateWebhookUrl(url)).ok).toBe(false);
    }
  });

  test('rejects blocked IPv6 literals including IPv4-mapped addresses', async () => {
    const urls = [
      'http://[::1]/hook',
      'http://[::]/hook',
      'http://[fc00::1]/hook',
      'http://[fe80::1]/hook',
      'http://[ff02::1]/hook',
      'http://[::ffff:127.0.0.1]/hook',
      'http://[::ffff:169.254.169.254]/hook',
    ];
    for (const url of urls) {
      expect((await validateWebhookUrl(url)).ok).toBe(false);
    }
  });

  test('rejects hostnames reserved for local or internal use', async () => {
    const urls = [
      'http://localhost/hook',
      'http://localhost./hook',
      'http://service.local/hook',
      'http://service.internal/hook',
      'http://metadata.google.internal/',
    ];
    for (const url of urls) {
      expect((await validateWebhookUrl(url)).ok).toBe(false);
    }
  });
});
