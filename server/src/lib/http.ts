export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function readJsonBody<T = Record<string, unknown>>(
  request: Request,
): Promise<T | null> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return null;
  }

  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}
