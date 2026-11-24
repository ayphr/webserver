import type { Server } from 'bun';
import { ASSISTANT_STREAM_PATH } from '@common';
import { resolveRoute } from './router';
import { assistantWebSocket, type AssistantSocketData } from './websocket';
import { addCorsHeaders, SECURITY_HEADERS } from './routes/util';
import { applyGlobalRateLimit } from './globalRateLimit';
import { bufferRequestBody, RequestBodyTooLargeError } from '../lib/bodyLimit';
import { setClientIp } from '../lib/requestContext';
import { createLogger } from '../lib/logger';
import { CORS_ALLOWED_ORIGINS, TRUST_PROXY } from '../env';
import {
  httpRequestDuration,
  httpRequestsTotal,
  httpRequestsInFlight,
  httpResponseSize,
  metricsText,
  registry,
} from '../lib/metrics';

const log = createLogger('http');
const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;

function parseTrustedProxyHops(): number {
  const raw = Bun.env.TRUST_PROXY_HOPS;
  if (!raw) return 1;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

const TRUSTED_PROXY_HOPS = parseTrustedProxyHops();

/**
 * X-Forwarded-For is a list of hops in request order. The rightmost entry is
 * the one your trusted reverse proxy appended, so it is the only safe value to
 * use by default. If additional hops are trusted, set TRUST_PROXY_HOPS to the
 * number of trusted hops on the right; every upstream value is client-controlled.
 * TRUST_PROXY must only be enabled when all traffic arrives via that proxy.
 */
export function resolveClientIp(
  request: Request,
  socketIp: string | null,
  trustProxy = TRUST_PROXY,
  trustedHopCount = TRUSTED_PROXY_HOPS,
): string | null {
  if (!trustProxy) return socketIp;

  const forwarded = request.headers.get('x-forwarded-for');
  const hops = (forwarded ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (hops.length === 0) return socketIp;

  const index = Math.max(0, hops.length - Math.max(1, trustedHopCount));
  return hops[index] || socketIp;
}

/** Browser WebSocket upgrades always send Origin; reject anything not allowlisted. */
export function isAllowedUpgradeOrigin(
  request: Request,
  allowedOrigins: readonly string[] = CORS_ALLOWED_ORIGINS,
): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;

  let normalized: string;
  try {
    normalized = new URL(origin).origin;
  } catch {
    return false;
  }

  return allowedOrigins.some((allowed) => {
    try {
      return new URL(allowed).origin === normalized;
    } catch {
      return false;
    }
  });
}

function getRequestBaseOrigin(request: Request): string {
  // Only trust forwarded headers when explicitly configured; otherwise a client
  // could spoof the host/proto used to normalize the request URL.
  let host = request.headers.get('host') || 'localhost';
  let proto: string | null = null;

  if (TRUST_PROXY) {
    const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
    if (forwardedHost) host = forwardedHost;
    if (forwardedProto === 'http' || forwardedProto === 'https') proto = forwardedProto;
  }

  if (!proto) {
    proto = request.url.startsWith('https://') ? 'https' : 'http';
  }

  return `${proto}://${host}`;
}

function normalizeRequest(request: Request): Request {
  const baseOrigin = getRequestBaseOrigin(request);

  try {
    return new Request(new URL(request.url, baseOrigin).toString(), request);
  } catch {
    return new Request(`${baseOrigin}/`, request);
  }
}

export function setupServer(port: number, callback: () => void): Server<AssistantSocketData> {
  const server: Server<AssistantSocketData> = Bun.serve<AssistantSocketData>({
    port,
    websocket: assistantWebSocket,
    // Coarse backstop; the precise 10 MB limit is enforced while reading below.
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES + 64 * 1024,

    async fetch(request) {
      const normalized = normalizeRequest(request);
      const clientIp = resolveClientIp(request, server.requestIP(request)?.address ?? null);
      setClientIp(normalized, clientIp);

      const url = new URL(normalized.url);
      if (
        url.pathname === ASSISTANT_STREAM_PATH &&
        request.headers.get('upgrade')?.toLowerCase() === 'websocket'
      ) {
        if (!isAllowedUpgradeOrigin(request)) {
          return addCorsHeaders(
            Response.json({ error: 'WebSocket origin not allowed' }, { status: 403, headers: SECURITY_HEADERS }),
            request,
          );
        }
        if (!server.upgrade(request, { data: { userUuid: null } })) {
          const response = Response.json(
            { error: 'WebSocket upgrade failed' },
            { status: 500, headers: SECURITY_HEADERS },
          );
          return addCorsHeaders(response, request);
        }
        return undefined;
      }

      const method = normalized.method;
      // Resolve once and reuse both the metric label and the handler. Calling
      // resolveRoute again after buffering duplicated work and let the route
      // change under a rewritten request.
      const { template, dispatch } = resolveRoute(normalized);

      const endTimer = httpRequestDuration.startTimer({ method, route: template });
      httpRequestsInFlight.inc();

      try {
        const declaredLength = request.headers.get('content-length');
        if (declaredLength !== null) {
          const length = Number(declaredLength);
          if (!Number.isFinite(length) || length < 0) {
            const response = Response.json(
              { error: 'Invalid Content-Length' },
              { status: 400, headers: SECURITY_HEADERS },
            );
            httpRequestsTotal.inc({ method, route: template, status: '400' });
            return addCorsHeaders(response, request);
          }
          if (length > MAX_REQUEST_BODY_BYTES) {
            const response = Response.json(
              { error: 'Request body too large' },
              { status: 413, headers: SECURITY_HEADERS },
            );
            httpRequestsTotal.inc({ method, route: template, status: '413' });
            return addCorsHeaders(response, request);
          }
        }

        // Coarse IP limiting runs before any body is buffered so an attacker
        // cannot force repeated large allocations without hitting a limiter.
        const rateLimited = await applyGlobalRateLimit(normalized, method, url.pathname, template);
        if (rateLimited) {
          httpRequestsTotal.inc({ method, route: template, status: rateLimited.status.toString() });
          return addCorsHeaders(rateLimited, request);
        }

        // Buffer a clone purely to enforce the byte limit. The dispatch
        // closure captured `normalized`, so its body stream must stay readable.
        await bufferRequestBody(normalized.clone() as unknown as Request, MAX_REQUEST_BODY_BYTES);

        const response = await dispatch();

        httpRequestsTotal.inc({ method, route: template, status: response.status.toString() });

        // Prefer the declared Content-Length header so we never have to buffer
        // the response body (which previously forced a full clone + read on
        // every request). When the header is absent we simply skip the size
        // observation rather than paying that cost.
        const declaredSize = response.headers.get('content-length');
        if (declaredSize !== null) {
          const size = Number(declaredSize);
          if (Number.isFinite(size) && size >= 0) {
            httpResponseSize.observe({ method, route: template }, size);
          }
        }

        return addCorsHeaders(response, request);
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          httpRequestsTotal.inc({ method, route: template, status: '413' });
          return addCorsHeaders(
            Response.json({ error: 'Request body too large' }, { status: 413, headers: SECURITY_HEADERS }),
            request,
          );
        }

        httpRequestsTotal.inc({ method, route: template, status: '500' });
        log.error({ error, method, route: template }, 'unhandled request error');
        const response = Response.json(
          { error: 'Internal Server Error' },
          { status: 500, headers: SECURITY_HEADERS },
        );
        return addCorsHeaders(response, request);
      } finally {
        httpRequestsInFlight.dec();
        endTimer();
      }
    },
  });

  callback();

  return server;
}

export function setupMetricsServer(port: number, callback: () => void): Server<undefined> {
  const server = Bun.serve({
    port,

    async fetch(request) {
      const pathname = new URL(request.url).pathname;

      if (pathname !== '/metrics') {
        return new Response('Not Found', { status: 404, headers: SECURITY_HEADERS });
      }

      const metrics = await metricsText();
      return new Response(metrics, {
        status: 200,
        headers: { 'Content-Type': registry.contentType, ...SECURITY_HEADERS },
      });
    },
  });

  callback();

  return server;
}
