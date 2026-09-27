import type { Server } from 'bun';
import { routeRequest } from './router';
import { addCorsHeaders } from './routes/util';
import { httpRequestDuration, httpRequestsTotal } from '../lib/metrics';
import { ensureValidCertificate, type CertConfig } from '../certs';

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

export async function setupServer(port: number, tls: boolean, callback: () => void): Promise<Server<undefined>> {
  let certConfig: CertConfig | null = null;
  if (tls) {
    certConfig = await ensureValidCertificate();

    if (!certConfig) {
      throw new Error('Failed to obtain valid TLS certificate');
    }
  }

  const server = Bun.serve({
    port,

    tls: tls ? { certFile: certConfig!.certPath, keyFile: certConfig!.keyPath } : undefined,

    async fetch(request) {
      const normalized = normalizeRequest(request);
      const method = normalized.method;
      const route = new URL(normalized.url).pathname;

      const endTimer = httpRequestDuration.startTimer({ method, route });

      try {
        const response = await routeRequest(normalized);
        const status = response.status.toString();

        httpRequestsTotal.inc({ method, route, status });
        return addCorsHeaders(response, request);
      } catch (error) {
        httpRequestsTotal.inc({ method, route, status: '500' });
        throw error;
      } finally {
        endTimer();
      }
    },
  });

  callback();

  return server;
}
