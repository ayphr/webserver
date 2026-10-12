import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolveRoute } from './router';
import { addCorsHeaders, SECURITY_HEADERS } from './routes/util';
import { setClientIp } from '../lib/requestContext';
import { createLogger } from '../lib/logger';
import {
  httpRequestDuration,
  httpRequestsTotal,
  httpRequestsInFlight,
  metricsText,
  registry,
} from '../lib/metrics';

const log = createLogger('http');

type RequestHandler = (request: Request) => Promise<Response> | Response;

export type HttpServerHandle = {
  server: http.Server;
  stop: () => Promise<void>;
};

function getRequestBaseOrigin(headers: Headers): string {
  const forwardedProto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || headers.get('host') || 'localhost';

  if (forwardedProto === 'http' || forwardedProto === 'https') {
    return `${forwardedProto}://${host}`;
  }

  return 'http://' + host;
}

function toWebRequest(req: IncomingMessage): Request {
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }

  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', getRequestBaseOrigin(headers));
  const init: RequestInit & { duplex?: 'half' } = { method, headers };

  if (method !== 'GET' && method !== 'HEAD') {
    init.duplex = 'half';
    init.body = Readable.toWeb(req) as unknown as ReadableStream;
  }

  return new Request(url, init);
}

async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  if (response.statusText) res.statusMessage = response.statusText;

  for (const [key, value] of response.headers.entries()) {
    if (key.toLowerCase() === 'set-cookie') continue;
    res.setHeader(key, value);
  }

  const setCookies = response.headers.getSetCookie?.() ?? [];
  if (setCookies.length > 0) res.setHeader('set-cookie', setCookies);

  if (!response.body) {
    res.end();
    return;
  }

  await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), res);
}

function startHttpServer(port: number, handler: RequestHandler, callback: () => void): HttpServerHandle {
  const server = http.createServer((req, res) => {
    const remoteAddress = req.socket.remoteAddress ?? null;

    void (async () => {
      let response: Response;

      try {
        const request = toWebRequest(req);
        setClientIp(request, remoteAddress);
        response = await handler(request);
      } catch (error) {
        log.error({ error, method: req.method, url: req.url }, 'unhandled request error');
        response = Response.json(
          { error: 'Internal Server Error' },
          { status: 500, headers: SECURITY_HEADERS },
        );
      }

      try {
        await writeResponse(res, response);
      } catch (error) {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end('Internal Server Error');
        } else {
          res.destroy();
        }
        log.error({ error }, 'failed to write response');
      }
    })();
  });

  server.listen(port, callback);

  return {
    server,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      }),
  };
}

export function setupServer(port: number, callback: () => void): HttpServerHandle {
  return startHttpServer(
    port,
    async (request) => {
      const method = request.method;
      const { template, dispatch } = resolveRoute(request);

      const endTimer = httpRequestDuration.startTimer({ method, route: template });
      httpRequestsInFlight.inc();

      try {
        const response = await dispatch();

        httpRequestsTotal.inc({ method, route: template, status: response.status.toString() });
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
    callback,
  );
}

export function setupMetricsServer(port: number, callback: () => void): HttpServerHandle {
  return startHttpServer(
    port,
    async (request) => {
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
    callback,
  );
}
