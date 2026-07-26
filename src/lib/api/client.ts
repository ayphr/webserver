import { type ApiErrorBody } from '../../../common';

export type ApiClientConfig = {
  baseUrl?: string;
  storageKey?: string;
};

export type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  auth?: boolean;
};

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly url: string;

  constructor(message: string, status: number, body: unknown, url: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

function normalizeBaseUrl(baseUrl?: string) {
  const trimmed = baseUrl?.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
}

function readStoredToken(storageKey: string) {
  if (globalThis.window === undefined) return null;
  return globalThis.localStorage.getItem(storageKey);
}

function writeStoredToken(storageKey: string, token: string | null) {
  if (typeof globalThis === 'undefined') return;

  if (token) {
    globalThis.localStorage.setItem(storageKey, token);
  } else {
    globalThis.localStorage.removeItem(storageKey);
  }
}

function buildUrl(baseUrl: string, path: string) {
  if (!baseUrl) return path;
  return `${baseUrl}${path}`;
}

function isIsoDateString(value: string) {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function reviveDateValues<T>(value: T): T {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'string') {
    return (isIsoDateString(value) ? new Date(value) : value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => reviveDateValues(item)) as T;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [key, reviveDateValues(nestedValue)])
  ) as T;
}

async function readResponseBody(response: Response) {
  const text = await response.text();
  if (!text) return null;

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      return reviveDateValues(JSON.parse(text) as unknown);
    } catch {
      return text;
    }
  }

  return text;
}

export function createAyphrRequestClient(config: ApiClientConfig = {}) {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const storageKey = config.storageKey ?? 'ayphr-api-token';

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers = new Headers(options.headers);
    const token = options.auth === false ? null : readStoredToken(storageKey);

    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(options.body);
    }

    const response = await fetch(buildUrl(baseUrl, path), {
      ...options,
      headers,
      body,
    });

    const responseBody = await readResponseBody(response);

    if (!response.ok) {
      const errorMessage = typeof responseBody === 'string'
        ? responseBody
        : (responseBody as ApiErrorBody | null)?.error
        ?? (responseBody as ApiErrorBody | null)?.message
        ?? `Request failed with status ${response.status}`;

      throw new ApiError(errorMessage, response.status, responseBody, response.url);
    }

    return responseBody as T;
  }

  async function requestJson<T>(path: string, options: RequestOptions = {}) {
    return request<T>(path, options);
  }

  async function requestText(path: string, options: RequestOptions = {}) {
    const body = await request<unknown>(path, options);
    return typeof body === 'string' ? body : '';
  }

  return {
    baseUrl,
    getAuthToken() {
      return readStoredToken(storageKey);
    },
    setAuthToken(token: string | null) {
      writeStoredToken(storageKey, token);
    },
    clearAuthToken() {
      writeStoredToken(storageKey, null);
    },
    requestJson,
    requestText,
    // serializeDate removed — use JS Date objects directly when constructing bodies
  };
}

export type AyphrRequestClient = ReturnType<typeof createAyphrRequestClient>;
