import { type ApiErrorBody } from '@common';
import { getStoredAccounts, removeStoredAccount, setActiveToken } from '../accounts';

export type ApiClientConfig = {
  baseUrl?: string;
  storageKey?: string;
  /** Invoked when an authenticated request is rejected with a 401. */
  onUnauthorized?: () => void;
};

export type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  auth?: boolean;
  /** Return the response body verbatim instead of parsing JSON. */
  raw?: boolean;
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

  /** Server-provided retry delay for 429 responses. */
  get retryAfterSeconds(): number | undefined {
    if (this.status !== 429) return undefined;
    const body = this.body as (ApiErrorBody & { retryAfterSeconds?: number }) | null;
    const seconds = body?.retryAfterSeconds;
    return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0
      ? seconds
      : undefined;
  }
}

function normalizeBaseUrl(baseUrl?: string) {
  const trimmed = baseUrl?.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
}

function readStoredToken(storageKey: string) {
  if (globalThis.window === undefined) return null;
  return globalThis.sessionStorage.getItem(storageKey);
}

function writeStoredToken(storageKey: string, token: string | null) {
  if (globalThis.window === undefined) return;

  if (token) {
    globalThis.sessionStorage.setItem(storageKey, token);
  } else {
    globalThis.sessionStorage.removeItem(storageKey);
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

export function createRequestClient(config: ApiClientConfig = {}) {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const storageKey = config.storageKey ?? 'ayphr-api-token';
  const onUnauthorized = config.onUnauthorized;

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers = new Headers(options.headers);
    const token = options.auth === false ? null : readStoredToken(storageKey);

    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      if (options.body instanceof FormData) {
        body = options.body;
      } else {
        headers.set('content-type', 'application/json');
        body = JSON.stringify(options.body);
      }
    }

    const response = await fetch(buildUrl(baseUrl, path), {
      ...options,
      headers,
      body,
    });

    // Raw exports are already the exact text we want to hand to the browser.
    // Errors still go through the regular parser so messages and 429/401 handling stay intact.
    const responseBody = response.ok && options.raw
      ? await response.text()
      : await readResponseBody(response);

    if (!response.ok) {
      const errorMessage = typeof responseBody === 'string'
        ? responseBody
        : (responseBody as ApiErrorBody | null)?.error
        ?? (responseBody as ApiErrorBody | null)?.message
        ?? `Request failed with status ${response.status}`;

      if (response.status === 401 && token) {
        removeStoredAccount(token);
        writeStoredToken(storageKey, null);
        const remaining = getStoredAccounts();
        if (remaining.length > 0) {
          setActiveToken(remaining[0].token);
          writeStoredToken(storageKey, remaining[0].token);
        } else {
          onUnauthorized?.();
        }
      }

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

  async function requestRawText(path: string, options: RequestOptions = {}) {
    return request<string>(path, { ...options, raw: true });
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
    requestRawText,
  };
}

export type RequestClient = ReturnType<typeof createRequestClient>;
