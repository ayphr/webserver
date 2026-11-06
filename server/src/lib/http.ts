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

export async function readValidatedJsonBody<T>(
  request: Request,
  validate: (value: unknown) => T,
): Promise<{ value: T } | { error: Response }> {
  const body = await readJsonBody<unknown>(request);
  if (body === null) {
    return { error: json({ error: 'request body must be valid JSON' }, 400) };
  }

  try {
    return { value: validate(body) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid request body';
    return { error: json({ error: message }, 400) };
  }
}

export function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

export function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
