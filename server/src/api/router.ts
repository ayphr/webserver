import {
  handleAcceptPolicies,
  handleChangePassword,
  handleDeleteAccount,
  handleLogin,
  handleVerifyLogin,
  handleLogout,
  handleLogoutAll,
  handleLogoutOthers,
  handleMe as handleAuthMe,
  handleRegister as handleAuthRegister,
} from './routes/auth';
import {
  handleRequestEmailCode,
  handleForgotPassword,
  handleResetPassword,
  handleEmailChangeRequest,
  handleEmailConfirm,
} from './routes/email';
import {
  handleApiNotFoundRoute,
  handleNotFoundRoute,
  handleOptionsRoute,
  handleReadinessRoute,
  handleStatusRoute,
} from './routes/util';
import { handlePunishment, handleMe as handlePunishmentsMe } from './routes/punishments';
import {
  handleStaffPunishmentLift,
  handleStaffPunishments,
  handleStaffPasswordUpdate,
  handleStaffRoleUpdate,
  handleStaffSubscriptionAttach,
  handleStaffSubscriptionDetach,
  handleStaffSubscriptionList,
  handleStaffSubscriptionUpdate,
  handleStaffUsers,
  handleUsersSummary,
} from './routes/staff';
import {
  handleFetchPairingToken,
  handleGetBySerial,
  handleDeviceGetData,
  handleDeviceQuery,
  handleDeviceDeleteDataPoints,
  handleDeviceUpdate,
  handleDeviceUnlink,
  handleLink,
  handleListMine,
  handleRequestPairing,
  handleUpload,
} from './routes/devices';
import { handleLocationsListMine, handleLocationCreate, handleLocationGet, handleLocationUpdate, handleLocationDelete } from './routes/locations';
import {
  handleListApps,
  handleCreateApp,
  handleGetApp,
  handleUpdateApp,
  handleDeleteApp,
  handleRegenerateSecret,
} from './routes/developer';
import {
  handlePublicApp,
  handleAuthorize,
  handleToken,
  handleUserinfo,
  handleOAuthDevices,
  handleConnectionsList,
  handleRevokeConnection,
  handleRevokeToken,
} from './routes/oauth';
import { handleAvatarDelete, handleAvatarGet, handleAvatarUpload } from './routes/avatars';
import { handleUserByUuid, handleMe as handleUsersMe, handleDeveloperToggle } from './routes/users';
import { handleCreditsMe } from './routes/credits';
import { handleGetBests as handleGamesBestsGet, handleUpdateBest as handleGamesBestsUpdate } from './routes/games';
import {
  handleStripeWebhook,
  handleSubscriptionAutoRenew,
  handleSubscriptionCancelGranted,
  handleSubscriptionCheckout,
  handleSubscriptionMe,
  handleSubscriptionPortal,
} from './routes/subscriptions';
import {
  handleTeamMe,
  handleTeamMembersList,
  handleTeamMemberAdd,
  handleTeamMemberRoleUpdate,
  handleTeamMemberRemove,
  handleTeamAuditLogs,
  handleTeamInvitesList,
  handleTeamInviteRevoke,
  handleTeamInviteAccept,
} from './routes/teams';
import { handleListMine as handleSessionsListMine, handleRevoke as handleSessionRevoke } from './routes/sessions';
import {
  handleCountries,
  handleCountryUpdate,
  handleMe as handleProfileMe,
  handleProfileEdit,
} from './routes/profile';
import { handleDomainChallenge, handleDomainVerify, handleDomainReverify } from './routes/profileDomain';
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
  { method: 'GET', path: '/api/status', handle: handleStatusRoute },
  { method: 'GET', path: '/api/ready', handle: handleReadinessRoute },

  { method: 'POST', path: '/api/auth/register', handle: handleAuthRegister },
  { method: 'POST', path: '/api/auth/login', handle: handleLogin },
  { method: 'POST', path: '/api/auth/login/verify', handle: handleVerifyLogin },
  { method: 'GET', path: '/api/auth/me', handle: handleAuthMe },
  { method: 'POST', path: '/api/auth/logout', handle: handleLogout },
  { method: 'POST', path: '/api/auth/logout-all', handle: handleLogoutAll },
  { method: 'POST', path: '/api/auth/logout-others', handle: handleLogoutOthers },
  { method: 'POST', path: '/api/auth/policies/accept', handle: handleAcceptPolicies },
  { method: 'POST', path: '/api/auth/password', handle: handleChangePassword },
  { method: 'DELETE', path: '/api/auth/account', handle: handleDeleteAccount },

  { method: 'POST', path: '/api/auth/email/code', handle: handleRequestEmailCode },
  { method: 'POST', path: '/api/auth/password/forgot', handle: handleForgotPassword },
  { method: 'POST', path: '/api/auth/password/reset', handle: handleResetPassword },
  { method: 'POST', path: '/api/auth/email/change', handle: handleEmailChangeRequest },
  { method: 'POST', path: '/api/auth/email/confirm', handle: handleEmailConfirm },

  { method: 'GET', path: '/api/users/me', handle: handleUsersMe },
  { method: 'GET', path: '/api/credits/me', handle: handleCreditsMe },
  { method: 'GET', path: '/api/games/bests', handle: handleGamesBestsGet },
  { method: 'POST', path: '/api/games/bests', handle: handleGamesBestsUpdate },
  { method: 'GET', path: '/api/users/:uuid', handle: handleUserByUuid },
  { method: 'PATCH', path: '/api/users/me/developer', handle: handleDeveloperToggle },

  { method: 'GET', path: '/api/avatars/:uuid', handle: handleAvatarGet },

  { method: 'POST', path: '/api/subscriptions/stripe/webhook', handle: handleStripeWebhook },
  { method: 'GET', path: '/api/subscriptions/me', handle: handleSubscriptionMe },
  { method: 'POST', path: '/api/subscriptions/checkout', handle: handleSubscriptionCheckout },
  { method: 'POST', path: '/api/subscriptions/auto-renew', handle: handleSubscriptionAutoRenew },
  { method: 'POST', path: '/api/subscriptions/portal', handle: handleSubscriptionPortal },
  { method: 'DELETE', path: '/api/subscriptions/attached/:id', handle: handleSubscriptionCancelGranted },

  { method: 'GET', path: '/api/team', handle: handleTeamMe },
  { method: 'GET', path: '/api/team/me', handle: handleTeamMe },
  { method: 'GET', path: '/api/teams', handle: handleTeamMe },
  { method: 'GET', path: '/api/teams/me', handle: handleTeamMe },
  { method: 'GET', path: '/api/team/members', handle: handleTeamMembersList },
  { method: 'GET', path: '/api/teams/members', handle: handleTeamMembersList },
  { method: 'POST', path: '/api/team/members', handle: handleTeamMemberAdd },
  { method: 'POST', path: '/api/teams/members', handle: handleTeamMemberAdd },
  { method: 'PATCH', path: '/api/team/members/:uuid', handle: handleTeamMemberRoleUpdate },
  { method: 'PATCH', path: '/api/teams/members/:uuid', handle: handleTeamMemberRoleUpdate },
  { method: 'PATCH', path: '/api/team/members/:uuid/role', handle: handleTeamMemberRoleUpdate },
  { method: 'PATCH', path: '/api/teams/members/:uuid/role', handle: handleTeamMemberRoleUpdate },
  { method: 'DELETE', path: '/api/team/members/:uuid', handle: handleTeamMemberRemove },
  { method: 'DELETE', path: '/api/teams/members/:uuid', handle: handleTeamMemberRemove },
  { method: 'GET', path: '/api/team/audit', handle: handleTeamAuditLogs },
  { method: 'GET', path: '/api/teams/audit', handle: handleTeamAuditLogs },
  { method: 'GET', path: '/api/team/audit-logs', handle: handleTeamAuditLogs },
  { method: 'GET', path: '/api/teams/audit-logs', handle: handleTeamAuditLogs },
  { method: 'GET', path: '/api/team/logs', handle: handleTeamAuditLogs },
  { method: 'GET', path: '/api/teams/logs', handle: handleTeamAuditLogs },

  { method: 'GET', path: '/api/team/invites', handle: handleTeamInvitesList },
  { method: 'GET', path: '/api/teams/invites', handle: handleTeamInvitesList },
  { method: 'DELETE', path: '/api/team/invites/:id', handle: handleTeamInviteRevoke },
  { method: 'DELETE', path: '/api/teams/invites/:id', handle: handleTeamInviteRevoke },
  { method: 'POST', path: '/api/team/invites/accept', handle: handleTeamInviteAccept },
  { method: 'POST', path: '/api/teams/invites/accept', handle: handleTeamInviteAccept },

  { method: 'GET', path: '/api/sessions', handle: handleSessionsListMine },
  { method: 'DELETE', path: '/api/sessions/:id', handle: handleSessionRevoke },

  { method: 'GET', path: '/api/punishments/me', handle: handlePunishmentsMe },
  { method: 'GET', path: '/api/punishments/:id', handle: handlePunishment },

  { method: 'POST', path: '/api/devices/pair', handle: handleRequestPairing },
  { method: 'GET', path: '/api/devices/pair/:code', handle: handleFetchPairingToken },
  { method: 'POST', path: '/api/devices/link', handle: handleLink },
  { method: 'POST', path: '/api/devices/data', handle: handleUpload },
  { method: 'GET', path: '/api/devices', handle: handleListMine },
  { method: 'GET', path: '/api/devices/mine', handle: handleListMine },
  { method: 'GET', path: '/api/devices/:serial/data', handle: handleDeviceGetData },
  { method: 'POST', path: '/api/devices/:serial/query', handle: handleDeviceQuery },
  { method: 'DELETE', path: '/api/devices/:serial/data', handle: handleDeviceDeleteDataPoints },
  { method: 'GET', path: '/api/devices/:serial', handle: handleGetBySerial },
  { method: 'PATCH', path: '/api/devices/:serial', handle: handleDeviceUpdate },
  { method: 'PUT', path: '/api/devices/:serial', handle: handleDeviceUpdate },
  { method: 'DELETE', path: '/api/devices/:serial', handle: handleDeviceUnlink },
  { method: 'POST', path: '/api/devices/:serial/unlink', handle: handleDeviceUnlink },

  { method: 'GET', path: '/api/locations', handle: handleLocationsListMine },
  { method: 'POST', path: '/api/locations', handle: handleLocationCreate },
  { method: 'GET', path: '/api/locations/:id', handle: handleLocationGet },
  { method: 'PATCH', path: '/api/locations/:id', handle: handleLocationUpdate },
  { method: 'DELETE', path: '/api/locations/:id', handle: handleLocationDelete },

  { method: 'GET', path: '/api/profile/me', handle: handleProfileMe },
  { method: 'GET', path: '/api/profile/countries', handle: handleCountries },
  { method: 'PATCH', path: '/api/profile/country', handle: handleCountryUpdate },
  { method: 'PATCH', path: '/api/profile/:uuid', handle: handleProfileEdit },
  { method: 'POST', path: '/api/profile/avatar', handle: handleAvatarUpload },
  { method: 'DELETE', path: '/api/profile/avatar', handle: handleAvatarDelete },

  { method: 'POST', path: '/api/profile/domain-challenge', handle: handleDomainChallenge },
  { method: 'POST', path: '/api/profile/domain-verify', handle: handleDomainVerify },
  { method: 'POST', path: '/api/profile/domain-reverify', handle: handleDomainReverify },

  { method: 'GET', path: '/api/developer/apps', handle: handleListApps },
  { method: 'POST', path: '/api/developer/apps', handle: handleCreateApp },
  { method: 'GET', path: '/api/developer/apps/:id', handle: handleGetApp },
  { method: 'PATCH', path: '/api/developer/apps/:id', handle: handleUpdateApp },
  { method: 'DELETE', path: '/api/developer/apps/:id', handle: handleDeleteApp },
  { method: 'POST', path: '/api/developer/apps/:id/regenerate-secret', handle: handleRegenerateSecret },

  { method: 'GET', path: '/api/oauth/apps/:clientId', handle: handlePublicApp },
  { method: 'POST', path: '/api/oauth/authorize', handle: handleAuthorize },
  { method: 'POST', path: '/api/oauth/token', handle: handleToken },
  { method: 'POST', path: '/api/oauth/revoke', handle: handleRevokeToken },
  { method: 'GET', path: '/api/oauth/userinfo', handle: handleUserinfo },
  { method: 'GET', path: '/api/oauth/devices', handle: handleOAuthDevices },

  { method: 'GET', path: '/api/connections', handle: handleConnectionsList },
  { method: 'DELETE', path: '/api/connections/:id', handle: handleRevokeConnection },

  { method: 'GET', path: '/api/staff/summary', handle: handleUsersSummary },
  { method: 'GET', path: '/api/staff/users', handle: handleStaffUsers },
  { method: 'POST', path: '/api/staff/role/:uuid', handle: handleStaffRoleUpdate },
  { method: 'POST', path: '/api/staff/password/:uuid', handle: handleStaffPasswordUpdate },
  { method: 'POST', path: '/api/staff/punishments/:id/lift', handle: handleStaffPunishmentLift },
  { method: 'GET', path: '/api/staff/punishments', handle: handleStaffPunishments },
  { method: 'POST', path: '/api/staff/punishments', handle: handleStaffPunishments },
  { method: 'POST', path: '/api/staff/subscriptions/:uuid', handle: handleStaffSubscriptionAttach },
  { method: 'GET', path: '/api/staff/subscriptions/:uuid', handle: handleStaffSubscriptionList },
  { method: 'DELETE', path: '/api/staff/subscriptions/:uuid/:id', handle: handleStaffSubscriptionDetach },
  { method: 'PATCH', path: '/api/staff/subscriptions/:uuid/:id', handle: handleStaffSubscriptionUpdate },
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

type CompiledRoute = RouteDefinition & {
  segments: readonly string[];
  params: number;
};

const COMPILED_ROUTES: readonly CompiledRoute[] = ROUTES.map((route) => ({
  ...route,
  segments: route.path.split('/'),
  params: countParams(route.path),
}));

const EXACT_ROUTES = new Map<string, CompiledRoute>();
const PARAM_ROUTES = new Map<string, CompiledRoute[]>();

for (const route of COMPILED_ROUTES) {
  if (route.params === 0) {
    EXACT_ROUTES.set(`${route.method} ${route.path}`, route);
    continue;
  }

  const list = PARAM_ROUTES.get(route.method);
  if (list) {
    list.push(route);
  } else {
    PARAM_ROUTES.set(route.method, [route]);
  }
}

// Fewer parameters first, then more literal segments (more specific paths) first,
// preserving the original declaration order for remaining ties.
for (const list of PARAM_ROUTES.values()) {
  list.sort((a, b) => {
    if (a.params !== b.params) return a.params - b.params;
    const aLiterals = a.segments.filter((segment) => !segment.startsWith(':')).length;
    const bLiterals = b.segments.filter((segment) => !segment.startsWith(':')).length;
    if (aLiterals !== bLiterals) return bLiterals - aLiterals;
    return 0;
  });
}

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function matchPath(patternSegments: readonly string[], pathSegments: string[]): RouteParams | null {
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

  const exact = EXACT_ROUTES.get(`${method} ${normalized}`);
  if (exact) {
    return { template: exact.path, params: {}, handle: exact.handle };
  }

  const candidates = PARAM_ROUTES.get(method);
  if (!candidates) return null;

  const pathSegments = normalized.split('/');

  for (const route of candidates) {
    if (route.segments.length !== pathSegments.length) continue;

    const params = matchPath(route.segments, pathSegments);
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
