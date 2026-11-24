import { API_VERSION_PREFIX } from './version';
import type { RouteDefinition } from './types';

type OpenApiDocument = {
  openapi: string;
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers: Array<{ url: string; description: string }>;
  paths: Record<string, Record<string, unknown>>;
  components: {
    securitySchemes: Record<string, unknown>;
  };
};

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

const PUBLIC_ROUTES = new Set([
  '/api/status',
  '/api/ready',
  '/api/openapi.json',
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/login/verify',
  '/api/auth/email/code',
  '/api/auth/password/forgot',
  '/api/auth/password/reset',
  '/api/devices/pair',
  '/api/devices/pair/:code',
  '/api/devices/link',
  '/api/subscriptions/stripe/webhook',
]);

function toOpenApiPath(path: string): string {
  return path.replace(/^\/api/, '').replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function operationId(method: string, path: string): string {
  const parts = path
    .replace(/^\/api\//, '')
    .split('/')
    .map((part) => part.replace(/^:/, 'by-').replace(/[^A-Za-z0-9-]/g, '-'));
  return [method.toLowerCase(), ...parts].join('_').replace(/-+/g, '-').replace(/-$/g, '');
}

function tagFor(path: string): string {
  const segments = path.split('/').filter(Boolean);
  const tag = segments[1] ?? 'misc';
  return tag === 'team' || tag === 'teams' ? 'teams' : tag;
}

function summaryFor(method: string, path: string): string {
  const parts = path.split('/').filter(Boolean).slice(1);
  const resource = parts.find((part) => !part.startsWith(':')) ?? 'resource';
  return `${method.toLowerCase()} ${resource}`;
}

function pathParameters(path: string): Array<Record<string, unknown>> {
  return [...path.matchAll(/:([A-Za-z0-9_]+)/g)]
    .map((match) => match[1])
    .filter((name): name is string => Boolean(name))
    .map((name) => ({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
}

/** Generates the API surface from the router registry. Payload schemas stay
 * intentionally generic until route metadata is enriched; the endpoint list,
 * version, and parameter names always match the live routes. */
export function buildOpenApiDocument(routes: readonly RouteDefinition[]): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of routes) {
    if (!HTTP_METHODS.has(route.method.toLowerCase())) continue;
    const openApiPath = toOpenApiPath(route.path);
    const pathItem = paths[openApiPath] ?? {};
    const parameters = pathParameters(route.path);
    const operation: Record<string, unknown> = {
      operationId: operationId(route.method, route.path),
      summary: summaryFor(route.method, route.path),
      tags: [tagFor(route.path)],
      responses: {
        '200': {
          description: 'Successful response',
          content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
        },
        '401': { description: 'Authentication required' },
        '404': { description: 'Resource not found' },
        '429': { description: 'Rate limit exceeded' },
      },
    };

    if (parameters.length > 0) operation.parameters = parameters;
    if (['POST', 'PUT', 'PATCH'].includes(route.method.toUpperCase())) {
      operation.requestBody = {
        required: true,
        content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
      };
    }
    if (!PUBLIC_ROUTES.has(route.path) && route.path !== '/api/avatars/:uuid') {
      operation.security = [{ bearerAuth: [] }];
    }

    pathItem[route.method.toLowerCase()] = operation;
    paths[openApiPath] = pathItem;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Ayphr API',
      version: '1.0.0',
      description: 'Generated route surface for the Ayphr API. Request and response payload schemas are generic and will be refined as shared types are catalogued.',
    },
    servers: [
      { url: API_VERSION_PREFIX, description: `Canonical API (${API_VERSION_PREFIX})` },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'opaque session token',
          description: `Bearer token returned by ${API_VERSION_PREFIX}/auth/login. Send it as \`Authorization: Bearer <token>\`.`,
        },
      },
    },
  };
}
