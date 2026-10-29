import type { Server } from 'bun';
import { resolveRoute } from './router';
import { addCorsHeaders, SECURITY_HEADERS } from './routes/util';
import { setClientIp } from '../lib/requestContext';
import { createLogger } from '../lib/logger';
import { TRUST_PROXY } from '../env';
import {
  httpRequestDuration,
  httpRequestsTotal,
  httpRequestsInFlight,
  httpResponseSize,
  metricsText,
  registry,
} from '../lib/metrics';

const log = createLogger('http');

function resolveClientIp(request: Request, socketIp: string | null): string | null {
  if (!TRUST_PROXY) return socketIp;

  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || socketIp;
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

export function setupServer(port: number, callback: () => void): Server<undefined> {
  const server = Bun.serve({
    port,

    async fetch(request) {
      const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;
      const contentLength = request.headers.get('content-length');
      if (contentLength) {
        const size = Number(contentLength);
        if (Number.isFinite(size) && size > MAX_REQUEST_BODY_BYTES) {
          const tooLarge = Response.json({ error: 'Request body too large' }, { status: 413, headers: SECURITY_HEADERS });
          return addCorsHeaders(tooLarge, request);
        }
      }

      const normalized = normalizeRequest(request);
      setClientIp(normalized, resolveClientIp(request, server.requestIP(request)?.address ?? null));
      const method = normalized.method;
      const { template, dispatch } = resolveRoute(normalized);

      const endTimer = httpRequestDuration.startTimer({ method, route: template });
      httpRequestsInFlight.inc();

      try {
        const response = await dispatch();

        httpRequestsTotal.inc({ method, route: template, status: response.status.toString() });

        const contentLength = response.headers.get('content-length');
        if (contentLength !== null) {
          const size = Number(contentLength);
          if (Number.isFinite(size) && size >= 0) {
            httpResponseSize.observe({ method, route: template }, size);
          }
        }

        return addCorsHeaders(response, request);
      } catch (error) {
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
