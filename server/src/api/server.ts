import type { Server } from 'bun';
import { resolveRoute } from './router';
import { addCorsHeaders } from './routes/util';
import { httpRequestDuration, httpRequestsTotal, httpRequestsInFlight } from '../lib/metrics';

function getRequestBaseOrigin(request: Request): string {
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || request.headers.get('host') || 'localhost';

  if (forwardedProto === 'http' || forwardedProto === 'https') {
    return `${forwardedProto}://${host}`;
  }

  return request.url.startsWith('https://') ? `https://${host}` : `http://${host}`;
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
      const normalized = normalizeRequest(request);
      const method = normalized.method;
      const { template, dispatch } = resolveRoute(normalized);

      if (method === 'GET' && template === '/metrics') {
        return addCorsHeaders(await dispatch(), request);
      }

      const endTimer = httpRequestDuration.startTimer({ method, route: template });
      httpRequestsInFlight.inc();

      try {
        const response = await dispatch();

        httpRequestsTotal.inc({ method, route: template, status: response.status.toString() });
        return addCorsHeaders(response, request);
      } catch (error) {
        httpRequestsTotal.inc({ method, route: template, status: '500' });
        throw error;
      } finally {
        httpRequestsInFlight.dec();
        endTimer();
      }
    },
  });

  callback();

  return server;
}
