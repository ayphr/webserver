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
import { handlePunishment, handleMe as handlePunishmentsMe, handleAppealSubmit, handleAppealGet } from './routes/punishments';
import {
  handleStaffPunishmentLift,
  handleStaffAppeals,
  handleStaffAppealResolve,
  handleStaffPunishments,
  handleStaffPasswordUpdate,
  handleStaffRoleUpdate,
  handleStaffUserTeams,
  handleStaffTeamUpdate,
  handleStaffTeamDelete,
  handleStaffTeamMemberRole,
  handleStaffTeamMemberRemove,
  handleStaffUserCredits,
  handleStaffUserDevices,
  handleStaffUserLocations,
  handleStaffUsers,
  handleStaffUserDelete,
  handleUsersSummary,
} from './routes/staff';
import {
  handleDeviceDataFill,
  handleFetchPairingToken,
  handleGetBySerial,
  handleDeviceLogs,
  handleDeviceUptime,
  handleDeviceGetData,
  handleDeviceQuery,
  handleQueryDevices,
  handleDeviceDeleteDataPoints,
  handleDeviceUpdate,
  handleDeviceUnlink,
  handleLink,
  handleListMine,
  handleRequestPairing,
  handleUpload,
  handleDeviceTokensList,
  handleDeviceTokenRevoke,
} from './routes/devices';
import { handleLocationsListMine, handleLocationCreate, handleLocationGet, handleLocationUpdate, handleLocationDelete } from './routes/locations';
import {
  handleAlertsList,
  handleAlertCreate,
  handleAlertUpdate,
  handleAlertDelete,
} from './routes/alerts';
import {
  handleIntegrationsListMine,
  handleIntegrationCreate,
  handleIntegrationGet,
  handleIntegrationUpdate,
  handleIntegrationDelete,
  handleIntegrationTest,
} from './routes/integrations';
import { handleAvatarDelete, handleAvatarGet, handleAvatarUpload } from './routes/avatars';
import { handleUserByUuid, handleMe as handleUsersMe, handleUsernameChange } from './routes/users';
import { handleCreditsMe } from './routes/credits';
import { handleGetBests as handleGamesBestsGet, handleUpdateBest as handleGamesBestsUpdate } from './routes/games';
import { handleGetState as handleAssistantGetState, handleSaveState as handleAssistantSaveState } from './routes/assistant';
import { handleStripeWebhook } from './routes/subscriptions';
import {
  handleTeamMe,
  handleTeamUpdate,
  handleTeamDelete,
  handleTeamMembersList,
  handleTeamMemberAdd,
  handleTeamMemberRoleUpdate,
  handleTeamMemberRemove,
  handleTeamAuditLogs,
  handleTeamInvitesList,
  handleTeamInviteRevoke,
  handleTeamInviteAccept,
  handlePendingTeamInvites,
  handleListMyTeams,
  handleSwitchTeam,
  handleCreateTeam,
  handleTeamSubscription,
  handleTeamSubscriptionCheckout,
  handleTeamPlanFree,
  handleTeamSubscriptionPortal,
} from './routes/teams';
import { handleListMine as handleSessionsListMine, handleRevoke as handleSessionRevoke } from './routes/sessions';
import {
  handleList as handleNotificationsList,
  handleUnreadCount as handleNotificationsUnreadCount,
  handleMarkRead as handleNotificationMarkRead,
  handleMarkAllRead as handleNotificationsMarkAllRead,
} from './routes/notifications';
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
  { method: 'GET', path: '/api/assistant', handle: handleAssistantGetState },
  { method: 'PUT', path: '/api/assistant', handle: handleAssistantSaveState },
  { method: 'GET', path: '/api/users/:uuid', handle: handleUserByUuid },
  { method: 'PATCH', path: '/api/users/me/username', handle: handleUsernameChange },

  { method: 'GET', path: '/api/avatars/:uuid', handle: handleAvatarGet },

  { method: 'POST', path: '/api/subscriptions/stripe/webhook', handle: handleStripeWebhook },

  { method: 'GET', path: '/api/team', handle: handleTeamMe },
  { method: 'GET', path: '/api/team/me', handle: handleTeamMe },
  { method: 'GET', path: '/api/teams', handle: handleTeamMe },
  { method: 'GET', path: '/api/teams/mine', handle: handleListMyTeams },
  { method: 'POST', path: '/api/teams/switch', handle: handleSwitchTeam },
  { method: 'POST', path: '/api/teams/create', handle: handleCreateTeam },
  { method: 'GET', path: '/api/team/subscription', handle: handleTeamSubscription },
  { method: 'POST', path: '/api/team/subscription/checkout', handle: handleTeamSubscriptionCheckout },
  { method: 'POST', path: '/api/team/subscription/free', handle: handleTeamPlanFree },
  { method: 'POST', path: '/api/team/subscription/portal', handle: handleTeamSubscriptionPortal },
  { method: 'GET', path: '/api/teams/me', handle: handleTeamMe },
  { method: 'PATCH', path: '/api/team', handle: handleTeamUpdate },
  { method: 'PATCH', path: '/api/teams', handle: handleTeamUpdate },
  { method: 'DELETE', path: '/api/teams', handle: handleTeamDelete },
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
  { method: 'GET', path: '/api/team/invites/pending', handle: handlePendingTeamInvites },
  { method: 'GET', path: '/api/teams/invites/pending', handle: handlePendingTeamInvites },

  { method: 'GET', path: '/api/sessions', handle: handleSessionsListMine },
  { method: 'DELETE', path: '/api/sessions/:id', handle: handleSessionRevoke },

  { method: 'GET', path: '/api/notifications', handle: handleNotificationsList },
  { method: 'GET', path: '/api/notifications/unread-count', handle: handleNotificationsUnreadCount },
  { method: 'POST', path: '/api/notifications/read-all', handle: handleNotificationsMarkAllRead },
  { method: 'POST', path: '/api/notifications/:id/read', handle: handleNotificationMarkRead },

  { method: 'GET', path: '/api/punishments/me', handle: handlePunishmentsMe },
  { method: 'GET', path: '/api/punishments/:id', handle: handlePunishment },
  { method: 'GET', path: '/api/punishments/:id/appeal', handle: handleAppealGet },
  { method: 'POST', path: '/api/punishments/:id/appeal', handle: handleAppealSubmit },

  { method: 'POST', path: '/api/devices/pair', handle: handleRequestPairing },
  { method: 'GET', path: '/api/devices/pair/:code', handle: handleFetchPairingToken },
  { method: 'POST', path: '/api/devices/link', handle: handleLink },
  { method: 'POST', path: '/api/devices/data', handle: handleUpload },
  { method: 'GET', path: '/api/devices', handle: handleListMine },
  { method: 'GET', path: '/api/devices/mine', handle: handleListMine },
  { method: 'POST', path: '/api/devices/query', handle: handleQueryDevices },
  { method: 'GET', path: '/api/devices/:serial/data', handle: handleDeviceGetData },
  { method: 'POST', path: '/api/devices/:serial/data/fill', handle: handleDeviceDataFill },
  { method: 'POST', path: '/api/devices/:serial/query', handle: handleDeviceQuery },
  { method: 'GET', path: '/api/devices/:serial/alerts', handle: handleAlertsList },
  { method: 'POST', path: '/api/devices/:serial/alerts', handle: handleAlertCreate },
  { method: 'PATCH', path: '/api/devices/:serial/alerts/:id', handle: handleAlertUpdate },
  { method: 'DELETE', path: '/api/devices/:serial/alerts/:id', handle: handleAlertDelete },
  { method: 'DELETE', path: '/api/devices/:serial/data', handle: handleDeviceDeleteDataPoints },
  { method: 'GET', path: '/api/devices/:serial/tokens', handle: handleDeviceTokensList },
  { method: 'GET', path: '/api/devices/:serial/upload-tokens', handle: handleDeviceTokensList },
  { method: 'DELETE', path: '/api/devices/:serial/tokens/:id', handle: handleDeviceTokenRevoke },
  { method: 'DELETE', path: '/api/devices/:serial/upload-tokens/:id', handle: handleDeviceTokenRevoke },
  { method: 'GET', path: '/api/devices/:serial', handle: handleGetBySerial },
  { method: 'GET', path: '/api/devices/:serial/uptime', handle: handleDeviceUptime },
  { method: 'GET', path: '/api/devices/:serial/logs', handle: handleDeviceLogs },
  { method: 'PATCH', path: '/api/devices/:serial', handle: handleDeviceUpdate },
  { method: 'PUT', path: '/api/devices/:serial', handle: handleDeviceUpdate },
  { method: 'DELETE', path: '/api/devices/:serial', handle: handleDeviceUnlink },
  { method: 'POST', path: '/api/devices/:serial/unlink', handle: handleDeviceUnlink },

  { method: 'GET', path: '/api/locations', handle: handleLocationsListMine },
  { method: 'POST', path: '/api/locations', handle: handleLocationCreate },
  { method: 'GET', path: '/api/locations/:id', handle: handleLocationGet },
  { method: 'PATCH', path: '/api/locations/:id', handle: handleLocationUpdate },
  { method: 'DELETE', path: '/api/locations/:id', handle: handleLocationDelete },

  { method: 'GET', path: '/api/integrations', handle: handleIntegrationsListMine },
  { method: 'POST', path: '/api/integrations', handle: handleIntegrationCreate },
  { method: 'GET', path: '/api/integrations/:id', handle: handleIntegrationGet },
  { method: 'PATCH', path: '/api/integrations/:id', handle: handleIntegrationUpdate },
  { method: 'DELETE', path: '/api/integrations/:id', handle: handleIntegrationDelete },
  { method: 'POST', path: '/api/integrations/:id/test', handle: handleIntegrationTest },

  { method: 'GET', path: '/api/profile/me', handle: handleProfileMe },
  { method: 'GET', path: '/api/profile/countries', handle: handleCountries },
  { method: 'PATCH', path: '/api/profile/country', handle: handleCountryUpdate },
  { method: 'PATCH', path: '/api/profile/:uuid', handle: handleProfileEdit },
  { method: 'POST', path: '/api/profile/avatar', handle: handleAvatarUpload },
  { method: 'DELETE', path: '/api/profile/avatar', handle: handleAvatarDelete },

  { method: 'POST', path: '/api/profile/domain-challenge', handle: handleDomainChallenge },
  { method: 'POST', path: '/api/profile/domain-verify', handle: handleDomainVerify },
  { method: 'POST', path: '/api/profile/domain-reverify', handle: handleDomainReverify },

  { method: 'GET', path: '/api/staff/summary', handle: handleUsersSummary },
  { method: 'GET', path: '/api/staff/users', handle: handleStaffUsers },
  { method: 'DELETE', path: '/api/staff/users/:uuid', handle: handleStaffUserDelete },
  { method: 'GET', path: '/api/staff/users/:uuid/teams', handle: handleStaffUserTeams },
  { method: 'GET', path: '/api/staff/users/:uuid/credits', handle: handleStaffUserCredits },
  { method: 'GET', path: '/api/staff/users/:uuid/devices', handle: handleStaffUserDevices },
  { method: 'GET', path: '/api/staff/users/:uuid/locations', handle: handleStaffUserLocations },
  { method: 'PATCH', path: '/api/staff/teams/:id', handle: handleStaffTeamUpdate },
  { method: 'DELETE', path: '/api/staff/teams/:id', handle: handleStaffTeamDelete },
  { method: 'PATCH', path: '/api/staff/teams/:id/members/:uuid/role', handle: handleStaffTeamMemberRole },
  { method: 'DELETE', path: '/api/staff/teams/:id/members/:uuid', handle: handleStaffTeamMemberRemove },
  { method: 'POST', path: '/api/staff/role/:uuid', handle: handleStaffRoleUpdate },
  { method: 'POST', path: '/api/staff/password/:uuid', handle: handleStaffPasswordUpdate },
  { method: 'POST', path: '/api/staff/punishments/:id/lift', handle: handleStaffPunishmentLift },
  { method: 'GET', path: '/api/staff/punishments', handle: handleStaffPunishments },
  { method: 'POST', path: '/api/staff/punishments', handle: handleStaffPunishments },
  { method: 'GET', path: '/api/staff/appeals', handle: handleStaffAppeals },
  { method: 'POST', path: '/api/staff/appeals/:id/resolve', handle: handleStaffAppealResolve },

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
  declarationOrder: number;
};

const COMPILED_ROUTES: readonly CompiledRoute[] = ROUTES.map((route, declarationOrder) => ({
  ...route,
  segments: route.path.split('/'),
  params: countParams(route.path),
  declarationOrder,
}));

// Dynamic routes are checked from most specific to least specific. This keeps
// literal routes such as `/notifications/unread-count` ahead of parameterized
// routes such as `/notifications/:id`, without maintaining separate indexes.
const SORTED_ROUTES = [...COMPILED_ROUTES].sort((a, b) => {
  if (a.params !== b.params) return a.params - b.params;

  const aLiterals = a.segments.filter((segment) => !segment.startsWith(':')).length;
  const bLiterals = b.segments.filter((segment) => !segment.startsWith(':')).length;
  if (aLiterals !== bLiterals) return bLiterals - aLiterals;

  return a.declarationOrder - b.declarationOrder;
});

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
  const pathSegments = normalized.split('/');

  for (const route of SORTED_ROUTES) {
    if (route.method !== method) continue;
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
