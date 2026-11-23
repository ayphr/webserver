import { randomUUID } from 'node:crypto';
import {
  evaluateAlertConditions,
  forecastFromHistory,
  forecastHorizons,
  getPlanFeatures,
  type DeviceAlert,
  type DeviceLogEvent,
  type NormalizedAssistantToolInput,
} from '@common';
import {
  countLocations,
  createAlert as insertAlert,
  createLocation as insertLocation,
  deleteAlert as deleteAlertInDb,
  ensureDefaultLocation,
  getAlertById,
  getAlertsForSerial,
  getAssistantState,
} from './db';
import {
  getDataPointStats,
  getDataPointsForDevice,
  getDeviceBySerial,
  getDeviceTokensForSerial,
  getDevicesForTeamId,
  getIntegrationsForTeamId,
  getLocationsForTeamId,
  getSessionsForUserUuid,
  getUserFromUuid,
  listNotificationsForUserUuid,
  countNotificationsForUserUuid,
  markAllNotificationsRead,
  markNotificationRead as markNotificationReadInDb,
  toPublicDevice,
  updateAlert as updateAlertInDb,
  updateDevice,
} from './db';
import { canManageTeam, getTeamForUser, getTeamScopeUuid } from './db/teams';
import { getTeamContext } from './teamContext';
import { getDeviceUptime as getDeviceUptimeForSerial } from './deviceUptimeService';
import { listDeviceLogs as listDeviceLogsForSerial } from './deviceLogService';
import { toPresentedDeviceTokens } from './deviceTokenService';
import { getCreditBalanceFromUuid } from './credits';
import { toSelfUser } from './user';
import { listTeamAuditLogs } from './teamAuditService';
import { getTeamInvites } from './teamInviteService';
import { teamSupportsAlertsAndWebhooks } from './planAccess';
import { sendTestAlert } from './alerts';

/** Loads the user and the devices inside their effective team scope. */
export const resolveAssistantScope = async (userUuid: string) => {
  const user = await getUserFromUuid(userUuid);
  if (!user) throw new Error('User not found');
  const scopeUuid = await getTeamScopeUuid(user);
  const devices = await getDevicesForTeamId(scopeUuid);
  return { user, scopeUuid, devices };
};

/** Resolves a device by name or serial, keeping team boundaries intact. */
export const resolveAssistantDevice = async (userUuid: string, deviceId?: string) => {
  const scope = await resolveAssistantScope(userUuid);
  const device = deviceId
    ? scope.devices.find(
        (candidate) =>
          String(candidate.serial) === deviceId ||
          candidate.name?.toLowerCase() === deviceId.toLowerCase(),
      )
    : scope.devices[0];
  if (!device) throw new Error('Device not found');
  if (device.teamId !== scope.scopeUuid) throw new Error('Device is outside your team scope');
  return { ...scope, device };
};

const round = (value: number, digits = 1) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;

/** Shared guard for any assistant tool that changes alert rules. */
const requireAlertManagement = async (userUuid: string) => {
  const { user, scopeUuid } = await resolveAssistantScope(userUuid);
  const team = await getTeamForUser(user);
  if (!team || !(await canManageTeam(user, team))) {
    throw new Error('You do not have permission to change alert rules');
  }
  if (!(await teamSupportsAlertsAndWebhooks(team))) {
    throw new Error('Alerts require a Plus or team plan');
  }
  return { scopeUuid };
};

const requireScopedAlert = async (userUuid: string, id: string) => {
  const { scopeUuid } = await requireAlertManagement(userUuid);
  const alert = await getAlertById(id);
  if (!alert || alert.teamId !== scopeUuid) throw new Error('Alert not found');
  return { alert, scopeUuid };
};

const validateAlertIntegrations = async (scopeUuid: string, ids: string[]) => {
  if (ids.length === 0) return [];
  const available = new Set((await getIntegrationsForTeamId(scopeUuid)).map((item) => item.id));
  if (!ids.every((id) => available.has(id))) throw new Error('Unknown notification destination');
  return ids;
};

const presentAlert = async (alert: DeviceAlert) => {
  const stats = await getDataPointStats([alert.serial]);
  const latest = stats.get(alert.serial)?.latest ?? null;
  return {
    ...alert,
    firing: Boolean(
      alert.enabled && latest && evaluateAlertConditions(alert.conditions, alert.logic, latest),
    ),
  };
};

const HELP_ARTICLES = [
  {
    title: 'Add and organize locations',
    topics: ['location', 'locations', 'place', 'room', 'group'],
    summary:
      'Open Locations from the dashboard to add a place, then assign devices to it from the device settings tab. The default location is created automatically.',
  },
  {
    title: 'Check device readings and history',
    topics: ['device', 'data', 'readings', 'temperature', 'humidity', 'pressure', 'graph'],
    summary:
      'Open a device to see its graphs. Use the time range controls to change the window, and the export button to download readings as CSV or JSON.',
  },
  {
    title: 'Forecast future readings',
    topics: ['forecast', 'prediction', 'future', 'trend', 'estimate'],
    summary:
      'The Forecast tab on a device projects temperature, humidity, and pressure from recent history. Longer horizons are less certain, so compare the uncertainty bands.',
  },
  {
    title: 'Set up alerts',
    topics: ['alert', 'alerts', 'notify', 'threshold', 'condition', 'webhook'],
    summary:
      'Alerts live in the Alerts tab of a device. Choose a metric, a comparison, and a threshold, then pick where notifications should go. Alerts and webhooks require a Plus or team plan.',
  },
  {
    title: 'Connect a webhook or chat integration',
    topics: ['integration', 'integrations', 'webhook', 'discord', 'slack', 'notification'],
    summary:
      'Integrations are added from the Integrations page and can then be selected as alert destinations. Webhook URLs are validated before they are saved.',
  },
  {
    title: 'Run a device query',
    topics: ['query', 'queries', 'tql', 'filter', 'aggregate'],
    summary:
      'The Queries page lets you filter and aggregate readings across devices with TQL. Boost queries can process more points and consume credits.',
  },
  {
    title: 'Understand credits and billing',
    topics: ['credit', 'credits', 'billing', 'plan', 'price', 'payment', 'subscription'],
    summary:
      'Credits are included with paid plans and can be added on top. Assistant chats and boosted queries use credits based on actual work; the Credits page shows the current balance.',
  },
  {
    title: 'Manage notifications',
    topics: ['notification', 'notifications', 'unread', 'push', 'email', 'read'],
    summary:
      'The Notifications page lists everything recent and has an unread filter. Notification preferences control which events arrive in the app, by email, and as push messages.',
  },
  {
    title: 'Manage your team',
    topics: ['team', 'members', 'invite', 'role', 'manager', 'audit'],
    summary:
      'Team owners and managers can invite members, change roles, and review the activity log from the Team page. Data is shared across the team scope.',
  },
  {
    title: 'Review active sign-ins',
    topics: ['session', 'sessions', 'sign in', 'login', 'security', 'device'],
    summary:
      'Settings shows currently active sessions with their browser, operating system, location, and last activity. You can sign out other sessions there.',
  },
  {
    title: 'Use the assistant safely',
    topics: ['assistant', 'iris', 'tools', 'permission', 'privacy', 'context'],
    summary:
      'Choose how much the assistant may do without asking, which actions need approval, and how much to be notified. Conversations can be compacted when they get long.',
  },
  {
    title: 'Control your privacy',
    topics: ['privacy', 'pii', 'redact', 'retention', 'delete', 'account'],
    summary:
      'Assistant preferences include PII redaction and chat retention. You can delete individual chats or your account from the profile and settings pages.',
  },
];

export const extendedAssistantToolData = {
  /** Recent availability of one device, or of the first device when omitted. */
  async getDeviceUptime(userUuid: string, deviceId?: string) {
    const { device } = await resolveAssistantDevice(userUuid, deviceId);
    const uptime = await getDeviceUptimeForSerial(device.serial);
    return {
      serial: device.serial,
      name: device.name,
      online: uptime.online,
      since: uptime.since,
      durationMs: uptime.durationMs,
    };
  },

  /** Recent activity and errors reported by a device. */
  async listDeviceLogs(
    userUuid: string,
    input: Pick<NormalizedAssistantToolInput, 'deviceId' | 'level' | 'event' | 'query' | 'limit'>,
  ) {
    const { device } = await resolveAssistantDevice(userUuid, input.deviceId);
    const filter = {
      ...(input.level !== 'all' ? { level: input.level as 'info' | 'warning' | 'error' } : {}),
      ...(input.event !== 'all' ? { event: input.event as DeviceLogEvent } : {}),
      ...(input.query ? { q: input.query } : {}),
    };
    const logs = await listDeviceLogsForSerial(device.serial, { limit: input.limit, filter });
    return { serial: device.serial, name: device.name, logs };
  },

  /** Upload token metadata, never the secret token hashes. */
  async listDeviceTokens(userUuid: string, deviceId: string | undefined, limit: number) {
    const { scopeUuid, device } = await resolveAssistantDevice(userUuid, deviceId);
    const tokens = await getDeviceTokensForSerial(device.serial, scopeUuid);
    return {
      serial: device.serial,
      name: device.name,
      tokens: toPresentedDeviceTokens(tokens).slice(0, limit),
    };
  },

  /** Short-horizon ensemble forecast from a device's recent history. */
  async forecastDevice(
    userUuid: string,
    input: Pick<NormalizedAssistantToolInput, 'deviceId' | 'hours' | 'limit'>,
  ) {
    const { device } = await resolveAssistantDevice(userUuid, input.deviceId);
    const hours = Math.min(168, Math.max(1, input.hours));
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const { points } = await getDataPointsForDevice(device.serial, { since, maxPoints: 2_000 });
    if (points.length < 20) {
      throw new Error('Not enough recent readings for a reliable forecast');
    }

    const allHorizons = forecastHorizons();
    const stride = Math.max(1, Math.ceil(allHorizons.length / 6));
    const horizons = allHorizons.filter(
      (_, index) => index % stride === 0 || index === allHorizons.length - 1,
    );
    const forecast = await forecastFromHistory(points, { horizons });
    if (!forecast) throw new Error('A forecast could not be produced');

    return {
      serial: device.serial,
      name: device.name,
      basedOnReadings: points.length,
      activeRegime: forecast.activeRegime,
      samples: forecast.horizons.map((horizon) => ({
        inMinutes: Math.round(horizon.horizonSeconds / 60),
        at: new Date(horizon.targetTimestamp),
        temperature: round(horizon.point.temperature),
        humidity: round(horizon.point.humidity),
        pressure: round(horizon.point.pressure, 0),
        uncertaintyTemperature: round(horizon.uncertainty.temperature),
        uncertaintyHumidity: round(horizon.uncertainty.humidity),
      })),
    };
  },

  /** Alert rules for a device, or all rules in the team scope. */
  async listAlerts(
    userUuid: string,
    input: Pick<NormalizedAssistantToolInput, 'deviceId' | 'limit'>,
  ) {
    const scope = await resolveAssistantScope(userUuid);
    const device = input.deviceId
      ? (await resolveAssistantDevice(userUuid, input.deviceId)).device
      : undefined;
    const targets = device ? [device] : scope.devices;
    const scopeUuid = scope.scopeUuid;
    const grouped = await Promise.all(
      targets.map(async (target) => ({
        serial: target.serial,
        name: target.name,
        alerts: await Promise.all(
          (await getAlertsForSerial(target.serial, scopeUuid)).map(presentAlert),
        ),
      })),
    );
    return { alerts: grouped.filter((group) => group.alerts.length > 0).slice(0, input.limit) };
  },

  /** Integrations without their webhook URLs. */
  async listIntegrations(userUuid: string) {
    const { scopeUuid } = await resolveAssistantScope(userUuid);
    const integrations = await getIntegrationsForTeamId(scopeUuid);
    return {
      integrations: integrations.map((integration) => ({
        id: integration.id,
        provider: integration.provider,
        enabled: integration.enabled,
        createdAt: integration.createdAt,
      })),
    };
  },

  /** One location plus its device counts. */
  async getLocation(userUuid: string, locationId?: string) {
    const { scopeUuid, devices } = await resolveAssistantScope(userUuid);
    const locations = await getLocationsForTeamId(scopeUuid);
    const location = locationId
      ? locations.find((candidate) => candidate.id === locationId)
      : locations.find((candidate) => candidate.isDefault) ?? locations[0];
    if (!location) throw new Error('Location not found');
    if (location.teamId !== scopeUuid) throw new Error('Location is outside your team scope');
    const assigned = devices.filter((device) => device.locationId === location.id);
    return { location, deviceCount: assigned.length, devices: assigned.map(toPublicDevice) };
  },

  /** Current credit balance for the user's plan. */
  async getCreditBalance(userUuid: string) {
    const balance = await getCreditBalanceFromUuid(userUuid);
    if (!balance) throw new Error('Credit balance is unavailable');
    return { balance };
  },

  /** Recent notifications and the unread total. */
  async listNotifications(
    userUuid: string,
    input: Pick<NormalizedAssistantToolInput, 'filter' | 'limit'>,
  ) {
    const [notifications, unreadCount] = await Promise.all([
      listNotificationsForUserUuid(userUuid, input.filter, { limit: input.limit }),
      countNotificationsForUserUuid(userUuid, 'unread'),
    ]);
    return {
      notifications: notifications.map(({ userUuid: _owner, ...notification }) => notification),
      unreadCount,
    };
  },

  /** Active sign-ins with secret hashes removed. */
  async listSessions(userUuid: string, limit: number) {
    const sessions = await getSessionsForUserUuid(userUuid);
    return {
      sessions: sessions.slice(0, limit).map((session) => ({
        id: session.id,
        deviceType: session.deviceType,
        browser: session.browser,
        os: session.os,
        location: session.location,
        createdAt: session.createdAt,
        lastActive: session.lastActive,
        expiresAt: session.expiresAt,
      })),
    };
  },

  /** Recent workspace changes. */
  async listTeamAudit(userUuid: string, limit: number) {
    const { user } = await resolveAssistantScope(userUuid);
    const { team } = await getTeamContext(user);
    if (!team) return { events: [] };
    return { events: await listTeamAuditLogs(team.id, { limit }) };
  },

  /** Outstanding workspace invitations, without their tokens. */
  async listTeamInvites(userUuid: string, limit: number) {
    const { user } = await resolveAssistantScope(userUuid);
    const { team } = await getTeamContext(user);
    if (!team) return { invites: [] };
    const invites = await getTeamInvites(team.id);
    return {
      invites: invites.slice(0, limit).map(({ token: _token, ...invite }) => invite),
    };
  },

  /** The signed-in user's own profile. */
  async getUserProfile(userUuid: string) {
    const user = await getUserFromUuid(userUuid);
    if (!user) throw new Error('User not found');
    return { profile: await toSelfUser(user) };
  },

  /** Conversation titles and sizes, without replaying every message. */
  async listAssistantChats(userUuid: string, limit: number) {
    const state = await getAssistantState(userUuid);
    const chats = (state?.chats ?? []).slice(0, limit).map((chat) => ({
      id: chat.id,
      title: chat.title,
      mode: chat.mode,
      folderId: chat.folderId,
      updatedAt: chat.updatedAt,
      messageCount: chat.messages.length,
    }));
    return { chats, folders: state?.folders ?? [] };
  },

  /** Curated, offline guidance for using the app. */
  async searchHelp(query: string, limit: number) {
    const terms = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 1);
    const ranked = HELP_ARTICLES.map((article) => {
      const haystack = `${article.title} ${article.topics.join(' ')} ${article.summary}`.toLowerCase();
      const score = terms.reduce(
        (total, term) => total + (haystack.includes(term) ? 1 : 0),
        0,
      );
      return { ...article, score };
    })
      .filter((article) => article.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.min(10, Math.max(1, limit)))
      .map(({ topics: _topics, score: _score, ...article }) => article);
    return { articles: ranked };
  },

  /** Marks one notification, or all of them, as read. */
  async markNotificationRead(
    userUuid: string,
    input: Pick<NormalizedAssistantToolInput, 'id' | 'all'>,
  ) {
    if (input.all) {
      const changed = await markAllNotificationsRead(userUuid);
      return { changed, message: `Marked ${changed} notification(s) as read.` };
    }
    const changed = await markNotificationReadInDb(userUuid, input.id as string);
    return {
      changed,
      message: changed ? 'Marked that notification as read.' : 'That notification was not found.',
    };
  },

  /** Adds an alert rule for a device. */
  async createAlert(
    userUuid: string,
    input: NormalizedAssistantToolInput,
  ) {
    const { scopeUuid } = await requireAlertManagement(userUuid);
    const { device } = await resolveAssistantDevice(userUuid, input.deviceId);
    const integrationIds = await validateAlertIntegrations(
      scopeUuid,
      input.integrationIds ?? [],
    );
    const now = new Date();
    const alert: DeviceAlert = {
      id: randomUUID(),
      serial: device.serial,
      teamId: scopeUuid,
      name: input.displayName as string,
      enabled: input.enabled ?? true,
      logic: input.logic ?? 'and',
      conditions: input.conditions as DeviceAlert['conditions'],
      integrationIds,
      repeatIntervalMinutes: input.repeatIntervalMinutes ?? 60,
      firing: false,
      mutedUntil: null,
      createdAt: now,
      updatedAt: now,
    };
    const created = await insertAlert(alert);
    return {
      alert: await presentAlert(created),
      message: `Created the alert “${created.name}".`,
    };
  },

  /** Edits any part of an existing alert rule. */
  async updateAlert(
    userUuid: string,
    input: NormalizedAssistantToolInput,
  ) {
    const { scopeUuid } = await requireAlertManagement(userUuid);
    const { alert } = await requireScopedAlert(userUuid, input.id as string);
    const updates: Partial<DeviceAlert> = {};

    if (input.displayName !== undefined) updates.name = input.displayName;
    if (input.logic !== undefined) updates.logic = input.logic;
    if (input.conditions !== undefined) {
      updates.conditions = input.conditions;
      updates.firing = false;
    }
    if (input.integrationIds !== undefined) {
      updates.integrationIds = await validateAlertIntegrations(scopeUuid, input.integrationIds);
    }
    if (input.repeatIntervalMinutes !== undefined) {
      updates.repeatIntervalMinutes = input.repeatIntervalMinutes;
    }
    if (input.enabled !== undefined) {
      updates.enabled = input.enabled;
      if (!input.enabled) updates.firing = false;
    }

    const updated = await updateAlertInDb(alert.id, updates);
    if (!updated) throw new Error('Alert could not be updated');
    return {
      alert: await presentAlert(updated),
      message: `Updated the alert “${updated.name}".`,
    };
  },

  /** Permanently removes an alert rule. */
  async deleteAlert(userUuid: string, id: string) {
    const { scopeUuid } = await requireAlertManagement(userUuid);
    const { alert } = await requireScopedAlert(userUuid, id);
    const deleted = await deleteAlertInDb(alert.id, scopeUuid);
    if (!deleted) throw new Error('Alert could not be deleted');
    return { deleted: true, message: `Deleted the alert “${alert.name}".` };
  },

  /** Sends a sample notification without changing the alert's state. */
  async testAlert(userUuid: string, id: string) {
    const { alert, scopeUuid } = await requireScopedAlert(userUuid, id);
    const device = await getDeviceBySerial(alert.serial);
    if (!device || device.teamId !== scopeUuid) throw new Error('Alert device not found');
    const stats = await getDataPointStats([alert.serial]);
    const reading = stats.get(alert.serial)?.latest;
    if (!reading) throw new Error('The device has no recent reading to test with');
    const integrations = await getIntegrationsForTeamId(scopeUuid);
    const results = await sendTestAlert(alert, device, reading, integrations);
    return {
      results,
      message: results.length === 0
        ? 'This alert has no active notification destinations.'
        : `Sent a test to ${results.length} destination(s).`,
    };
  },

  /** Pauses or resumes an alert's notifications. */
  async muteAlert(
    userUuid: string,
    input: Pick<NormalizedAssistantToolInput, 'id' | 'minutes'>,
  ) {
    const { alert } = await requireScopedAlert(userUuid, input.id as string);

    const mutedUntil = input.minutes > 0 ? new Date(Date.now() + input.minutes * 60_000) : null;
    const updated = await updateAlertInDb(alert.id, { mutedUntil });
    if (!updated) throw new Error('Alert could not be updated');
    return {
      alert: { id: updated.id, name: updated.name, mutedUntil: updated.mutedUntil },
      message: mutedUntil
        ? `Paused notifications for ${updated.name}.`
        : `Resumed notifications for ${updated.name}.`,
    };
  },

  /** Adds a location, honoring the plan limit and team role rules. */
  async createLocation(userUuid: string, name: string) {
    const { user, scopeUuid } = await resolveAssistantScope(userUuid);
    const { role, scopeUsername } = await getTeamContext(user);
    const team = await getTeamForUser(user);
    if (team && role === 'member') {
      throw new Error('Only team managers can add locations');
    }
    await ensureDefaultLocation(scopeUuid, scopeUsername);
    const maxLocations = getPlanFeatures(team?.tier ?? 'free').maxLocations;
    if ((await countLocations(scopeUuid)) >= maxLocations) {
      throw new Error('Your plan’s location limit has been reached');
    }
    const location = await insertLocation({
      id: randomUUID(),
      teamId: scopeUuid,
      ownerUsername: scopeUsername,
      name,
      isDefault: false,
      createdAt: new Date(),
    });
    return { location, message: `Added the location “${location.name}".` };
  },

  /** Renames a device within the user's team scope. */
  async renameDevice(userUuid: string, deviceId: string | undefined, name: string) {
    const { scopeUuid, device } = await resolveAssistantDevice(userUuid, deviceId);
    const updated = await updateDevice(device.serial, scopeUuid, { name });
    if (!updated) throw new Error('Device could not be renamed');
    return {
      device: toPublicDevice(updated),
      message: `Renamed device ${updated.serial} to “${updated.name}".`,
    };
  },
};
