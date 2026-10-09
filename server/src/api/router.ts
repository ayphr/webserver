import {
  handleAcceptPolicies,
  handleDeleteAccount,
  handleLogin,
  handleLogout,
  handleLogoutAll,
  handleMe as handleAuthMe,
  handleRegister as handleAuthRegister,
} from './routes/auth';
import {
  handleApiNotFoundRoute,
  handleMetricsRoute,
  handleNotFoundRoute,
  handleOptionsRoute,
  handleStatusRoute,
} from './routes/util';
import { handlePunishment, handleMe as handlePunishmentsMe } from './routes/punishments';
import {
  handleStaffPunishmentLift,
  handleStaffPunishments,
  handleStaffRoleUpdate,
  handleStaffUsers,
  handleUsersSummary,
} from './routes/staff';
import { handleGetBySerial, handleListMine, handleRegister as handleDeviceRegister } from './routes/devices';
import { handleUserByUuid, handleMe as handleUsersMe } from './routes/users';
import {
  handleCountries,
  handleCountryUpdate,
  handleMe as handleProfileMe,
  handleProfileEdit,
} from './routes/profile';
import type { ResolvedRoute, RouteHandler, RouteParams } from './types';

type RouteMatch = {
  template: string;
  params: RouteParams;
  handle: RouteHandler;
};

type RouteDefinition = {
  method: string;
  path: string;
  handle: RouteHandler;
};

const ROUTES: readonly RouteDefinition[] = [
  { method: 'GET', path: '/metrics', handle: handleMetricsRoute },
  { method: 'GET', path: '/api/status', handle: handleStatusRoute },

  { method: 'POST', path: '/api/auth/register', handle: handleAuthRegister },
  { method: 'POST', path: '/api/auth/login', handle: handleLogin },
  { method: 'GET', path: '/api/auth/me', handle: handleAuthMe },
  { method: 'POST', path: '/api/auth/logout', handle: handleLogout },
  { method: 'POST', path: '/api/auth/logout-all', handle: handleLogoutAll },
  { method: 'POST', path: '/api/auth/policies/accept', handle: handleAcceptPolicies },
  { method: 'DELETE', path: '/api/auth/account', handle: handleDeleteAccount },

  { method: 'GET', path: '/api/users/me', handle: handleUsersMe },
  { method: 'GET', path: '/api/users/:uuid', handle: handleUserByUuid },

  { method: 'GET', path: '/api/punishments/me', handle: handlePunishmentsMe },
  { method: 'GET', path: '/api/punishments/:id', handle: handlePunishment },

  { method: 'POST', path: '/api/devices', handle: handleDeviceRegister },
  { method: 'POST', path: '/api/devices/register', handle: handleDeviceRegister },
  { method: 'GET', path: '/api/devices', handle: handleListMine },
  { method: 'GET', path: '/api/devices/mine', handle: handleListMine },
  { method: 'GET', path: '/api/devices/:serial', handle: handleGetBySerial },

  { method: 'GET', path: '/api/profile/me', handle: handleProfileMe },
  { method: 'GET', path: '/api/profile/countries', handle: handleCountries },
  { method: 'PATCH', path: '/api/profile/country', handle: handleCountryUpdate },
  { method: 'PATCH', path: '/api/profile/:uuid', handle: handleProfileEdit },

  { method: 'GET', path: '/api/staff/summary', handle: handleUsersSummary },
  { method: 'GET', path: '/api/staff/users', handle: handleStaffUsers },
  { method: 'POST', path: '/api/staff/role/:uuid', handle: handleStaffRoleUpdate },
  { method: 'POST', path: '/api/staff/punishments/:id/lift', handle: handleStaffPunishmentLift },
  { method: 'GET', path: '/api/staff/punishments', handle: handleStaffPunishments },
  { method: 'POST', path: '/api/staff/punishments', handle: handleStaffPunishments },
];

const UNMATCHED_API_TEMPLATE = '/api/other';
const UNMATCHED_ROOT_TEMPLATE = '/other';

export function cleanPathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function countParams(path: string): number {
  return path.split('/').filter((segment) => segment.startsWith(':')).length;
}

const MATCH_ORDER: readonly RouteDefinition[] = [...ROUTES].sort((a, b) => countParams(a.path) - countParams(b.path));

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function matchPath(pattern: string, pathname: string): RouteParams | null {
  const patternSegments = pattern.split('/');
  const pathSegments = pathname.split('/');

  if (patternSegments.length !== pathSegments.length) {
    return null;
  }

  const params: RouteParams = {};

  for (let index = 0; index < patternSegments.length; index += 1) {
    const patternSegment = patternSegments[index] ?? '';
    const pathSegment = pathSegments[index] ?? '';

    if (patternSegment.startsWith(':')) {
      if (!pathSegment) {
        return null;
      }
      params[patternSegment.slice(1)] = pathSegment;
    } else if (patternSegment !== pathSegment) {
      return null;
    }
  }

  return params;
}

export function matchRoute(method: string, pathname: string): RouteMatch | null {
  const normalized = cleanPathname(pathname);

  for (const route of MATCH_ORDER) {
    if (route.method !== method) {
      continue;
    }

    const params = matchPath(route.path, normalized);
    if (params) {
      return { template: route.path, params, handle: route.handle };
    }
  }

  return null;
}

export function resolveRoute(request: Request): ResolvedRoute {
  const pathname = cleanPathname(new URL(request.url).pathname);

  if (request.method === 'OPTIONS' && isApiPath(pathname)) {
    return { template: UNMATCHED_API_TEMPLATE, dispatch: () => handleOptionsRoute(request) };
  }

  const match = matchRoute(request.method, pathname);

  if (match) {
    return { template: match.template, dispatch: () => match.handle(request, match.params) };
  }

  return {
    template: isApiPath(pathname) ? UNMATCHED_API_TEMPLATE : UNMATCHED_ROOT_TEMPLATE,
    dispatch: () => (isApiPath(pathname) ? handleApiNotFoundRoute(request) : handleNotFoundRoute(request)),
  };
}
