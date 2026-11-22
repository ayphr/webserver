import { describe, expect, test } from 'bun:test';
import { bufferRequestBody, RequestBodyTooLargeError } from './bodyLimit';

function streamedRequest(chunks: string[], headers: Record<string, string> = {}): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
  return new Request('https://example.test/api/devices/data', {
    method: 'POST',
    headers,
    body: stream,
    duplex: 'half',
  } as RequestInit);
}

describe('bufferRequestBody', () => {
  test('preserves the body for normal JSON requests', async () => {
    const original = streamedRequest(['{"hello":', '"world"}'], { 'content-type': 'application/json' });
    const bounded = await bufferRequestBody(original, 128);
    expect(await bounded.json()).toEqual({ hello: 'world' });
    expect(bounded.headers.get('content-length')).toBe('17');
  });

  test('rejects chunked bodies that exceed the limit without Content-Length', async () => {
    const original = streamedRequest(['12345', '67890', '1'], { 'content-type': 'text/plain' });
    expect(original.headers.has('content-length')).toBe(false);
    await expect(bufferRequestBody(original, 10)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  test('rejects an oversized declared length before reading the stream', async () => {
    const original = new Request('https://example.test/api/devices/data', {
      method: 'POST',
      headers: { 'content-length': '999', 'content-type': 'application/json' },
      body: '{}',
    });
    await expect(bufferRequestBody(original, 10)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  test('leaves bodyless requests untouched', async () => {
    const original = new Request('https://example.test/api/devices');
    expect(await bufferRequestBody(original, 1)).toBe(original);
  });
});
