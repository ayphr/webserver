import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import {
  buildClientSource,
  extractRoutes,
  operationId,
  readApiVersion,
  validateRoutes,
  type GeneratedRoute,
} from './generate-api-client';

const VERSION_SOURCE = `/** API_VERSION = 'decoy'; */
export const API_VERSION = 'v2';
export const API_VERSION_PREFIX = \`/api/\${API_VERSION}\`;
`;

const routeEntry = (method: string, path: string, handle = 'sharedHandler') =>
  `  { method: '${method}', path: '${path}', handle: ${handle} },`;

const routerSource = (...entries: string[]) => `
// method: 'GET', path: '/api/decoy' (must be ignored)
const ROUTES: readonly RouteDefinition[] = [
${entries.join('\n')}
];
`;

describe('generate-api-client', () => {
  it('reads the version constant from the AST, ignoring decoy strings', () => {
    expect(readApiVersion(VERSION_SOURCE)).toBe('v2');
  });

  it('keeps handler aliases as separate versioned routes', () => {
    const routes = extractRoutes(routerSource(
      routeEntry('GET', '/api/team', 'handleTeamMe'),
      routeEntry('GET', '/api/team/me', 'handleTeamMe'),
      routeEntry('GET', '/api/teams', 'handleTeamMe'),
    ), 'v2');

    expect(routes.map((route) => route.path)).toEqual([
      '/api/v2/team',
      '/api/v2/team/me',
      '/api/v2/teams',
    ]);
    expect(routes.map((route) => route.operationId)).toEqual([
      'getTeam',
      'getTeamMe',
      'getTeams',
    ]);
    expect(routes.every((route) => route.method === 'GET')).toBe(true);
  });

  it('preserves path parameters and unusual route roots', () => {
    const routes = extractRoutes(routerSource(
      routeEntry('DELETE', '/api/assistant/chats/:id'),
      routeEntry('GET', '/api'),
      routeEntry('GET', 'relative/path'),
    ), 'v1');

    expect(routes.map((route) => route.path)).toEqual([
      '/api/v1/assistant/chats/:id',
      '/api/v1',
      '/api/v1/relative/path',
    ]);
    expect(routes[0]?.operationId).toBe('deleteAssistantChatsId');
  });

  it('rejects duplicate method/path pairs and colliding operation ids', () => {
    expect(() => extractRoutes(routerSource(
      routeEntry('GET', '/api/status'),
      routeEntry('GET', '/api/status', 'otherHandler'),
    ), 'v1')).toThrow('Duplicate generated route: GET /api/v1/status');

    expect(() => extractRoutes(routerSource(
      routeEntry('GET', '/api/teams/me'),
      routeEntry('GET', '/api/teams-me'),
    ), 'v1')).toThrow('Duplicate generated operation id: getTeamsMe');
  });

  it('rejects non-literal or incomplete route entries', () => {
    expect(() => extractRoutes(routerSource('  ...dynamicRoutes,'), 'v1')).toThrow('non-literal');
    expect(() => extractRoutes(routerSource("  { method: 'GET' },"), 'v1')).toThrow('literal `method` and `path`');
  });

  it('derives stable operation ids', () => {
    expect(operationId('POST', '/api/auth/login/verify')).toBe('postAuthLoginVerify');
    expect(operationId('GET', '/api/openapi.json')).toBe('getOpenapiJson');
  });

  it('emits a stable, formatted client and validates before writing', () => {
    const routes: GeneratedRoute[] = [{
      method: 'GET',
      path: '/api/v1/status',
      operationId: 'getStatus',
    }];
    const source = buildClientSource('v1', routes);

    expect(source).toContain("export const API_VERSION = 'v1' as const;");
    expect(source).toContain("    operationId: 'getStatus',");
    expect(source).toContain("  getStatus: '/api/v1/status'");
    expect(source).toContain('export function apiPath(');
    expect(buildClientSource('v1', routes)).toBe(source);
    expect(() => validateRoutes([...routes, ...routes])).toThrow('Duplicate generated route');
  });

  it('parses the live router without evaluating its handler imports', () => {
    const router = readFileSync(new URL('../src/api/router.ts', import.meta.url), 'utf8');
    const version = readApiVersion(readFileSync(new URL('../src/api/version.ts', import.meta.url), 'utf8'));
    const routes = extractRoutes(router, version);

    expect(routes.length).toBeGreaterThan(100);
    expect(routes.every((route) => route.path.startsWith(`/api/${version}/`) || route.path === `/api/${version}`)).toBe(true);
  });
});
