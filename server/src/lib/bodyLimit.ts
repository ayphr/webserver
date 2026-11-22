export class RequestBodyTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`Request body exceeds ${limit} bytes`);
    this.name = 'RequestBodyTooLargeError';
  }
}

function declaredContentLength(request: Request): number | null {
  const raw = request.headers.get('content-length');
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Buffers a request body while enforcing a hard byte ceiling. Reading the
 * stream (rather than trusting Content-Length) closes the chunked-body bypass.
 * The returned Request is safe to hand to json()/text()/formData() handlers.
 */
export async function bufferRequestBody(
  request: Request,
  limit: number,
): Promise<Request> {
  if (!request.body || request.method === 'GET' || request.method === 'HEAD') {
    return request;
  }

  const declared = declaredContentLength(request);
  if (declared !== null && declared > limit) throw new RequestBodyTooLargeError(limit);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new RequestBodyTooLargeError(limit);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  }

  if (total === 0) return new Request(request.url, { method: request.method, headers: request.headers });

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const headers = new Headers(request.headers);
  headers.set('content-length', String(total));
  return new Request(request.url, {
    method: request.method,
    headers,
    body,
    signal: request.signal,
  });
}
