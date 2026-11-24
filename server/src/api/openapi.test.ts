import { describe, expect, test } from 'bun:test';
import { buildOpenApiDocument } from './openapi';
import type { RouteDefinition } from './types';

const routes: readonly RouteDefinition[] = [
  { method: 'GET', path: '/api/status', handle: () => new Response() },
  { method: 'GET', path: '/api/devices/:serial/logs', handle: () => new Response() },
  { method: 'POST', path: '/api/devices/:serial/alerts', handle: () => new Response() },
];

describe('buildOpenApiDocument', () => {
  const doc = buildOpenApiDocument(routes);

  test('exposes only the canonical versioned server', () => {
    expect(doc.servers.map((server) => server.url)).toEqual(['/api/v1']);
  });

  test('converts colon params and adds path parameters', () => {
    expect(doc.paths['/devices/{serial}/logs']?.get).toBeDefined();
    expect(doc.paths['/devices/{serial}/logs']?.get).toMatchObject({
      parameters: [{ name: 'serial', in: 'path', required: true }],
    });
  });

  test('adds request bodies and bearer auth for protected mutations', () => {
    expect(doc.paths['/devices/{serial}/alerts']?.post).toMatchObject({
      requestBody: { required: true },
      security: [{ bearerAuth: [] }],
    });
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    expect(doc.components.securitySchemes).not.toHaveProperty('sessionCookie');
  });
});
