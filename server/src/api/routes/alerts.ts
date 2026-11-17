import { json, readJsonBody } from '../../lib/http';
import { requireAuth } from '../auth';
import {
  createAlert,
  deleteAlert,
  getAlertById,
  getAlertsForSerial,
  getDataPointStats,
  getDeviceBySerial,
  getIntegrationsForTeamId,
  updateAlert,
} from '../../lib/db';
import type { DeviceDocument } from '../../lib/db';
import { canManageTeam, getTeamForUser, getTeamScopeUuid } from '../../lib/db/teams';
import {
  ALERT_LOGIC,
  ALERT_MAX_CONDITIONS,
  ALERT_MAX_REPEAT_MINUTES,
  ALERT_METRICS,
  ALERT_MIN_REPEAT_MINUTES,
  ALERT_NAME_MAX_LENGTH,
  ALERT_OPERATORS,
  evaluateAlertConditions,
  type AlertCondition,
  type AlertLogic,
  type AlertMetric,
  type AlertOperator,
  type DeviceAlert,
  type DataPoint,
  type User,
} from '@common';

const MAX_INTEGRATIONS_PER_ALERT = 20;
const MAX_SERIAL = 0xFFFFFFFF;

function parseSerial(value: unknown): number | null {
  let serial: number;

  if (typeof value === 'number') {
    serial = value;
  } else if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    serial = Number(value.trim());
  } else {
    return null;
  }

  if (!Number.isInteger(serial) || serial < 0 || serial > MAX_SERIAL) return null;
  return serial;
}

function parseName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || name.length > ALERT_NAME_MAX_LENGTH) return null;
  return name;
}

function parseLogic(value: unknown): AlertLogic | null {
  if (typeof value !== 'string') return null;
  return (ALERT_LOGIC as readonly string[]).includes(value) ? (value as AlertLogic) : null;
}

function parseConditions(value: unknown): AlertCondition[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > ALERT_MAX_CONDITIONS) return null;

  const conditions: AlertCondition[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;
    const item = entry as Record<string, unknown>;

    const metric = item.metric;
    if (typeof metric !== 'string' || !(ALERT_METRICS as readonly string[]).includes(metric)) return null;

    const operator = item.operator;
    if (typeof operator !== 'string' || !(ALERT_OPERATORS as readonly string[]).includes(operator)) return null;

    if (typeof item.value !== 'number' || !Number.isFinite(item.value)) return null;

    conditions.push({
      metric: metric as AlertMetric,
      operator: operator as AlertOperator,
      value: item.value,
    });
  }

  return conditions;
}

function parseIntegrationIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_INTEGRATIONS_PER_ALERT) return null;
  if (!value.every((id): id is string => typeof id === 'string' && id.length > 0)) return null;
  return [...new Set(value)];
}

function parseRepeatInterval(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < ALERT_MIN_REPEAT_MINUTES || value > ALERT_MAX_REPEAT_MINUTES) return null;
  return value;
}

type ScopedDevice = {
  device: DeviceDocument;
  scopeUuid: string;
  serial: number;
};

async function getScopedDevice(user: User, params: Record<string, string>): Promise<ScopedDevice | Response> {
  const serial = parseSerial(params.serial);
  if (serial === null) return json({ error: 'invalid serial' }, 400);

  const device = await getDeviceBySerial(serial);
  if (!device) return json({ error: 'not found' }, 404);

  const scopeUuid = await getTeamScopeUuid(user);
  if (device.teamId !== scopeUuid) return json({ error: 'forbidden' }, 403);

  return { device, scopeUuid, serial };
}

async function canManageAlerts(user: User): Promise<boolean> {
  const team = await getTeamForUser(user);
  return Boolean(team && canManageTeam(user, team));
}

async function validateIntegrationIds(
  scopeUuid: string,
  ids: string[],
): Promise<string[] | null> {
  if (ids.length === 0) return [];

  const integrations = await getIntegrationsForTeamId(scopeUuid);
  const available = new Set(integrations.map((integration) => integration.id));
  if (!ids.every((id) => available.has(id))) return null;
  return ids;
}

function computeFiring(alert: DeviceAlert, latest: DataPoint | null): boolean {
  if (!alert.enabled || !latest) return false;
  return evaluateAlertConditions(alert.conditions, alert.logic, latest);
}

const handleListAlerts = requireAuth(async (_request, user: User, params) => {
  const scope = await getScopedDevice(user, params);
  if (scope instanceof Response) return scope;

  const [alerts, stats] = await Promise.all([
    getAlertsForSerial(scope.serial, scope.scopeUuid),
    getDataPointStats([scope.serial]),
  ]);

  const latest = stats.get(scope.serial)?.latest ?? null;
  const presented = alerts.map((alert) => ({ ...alert, firing: computeFiring(alert, latest) }));

  return json({ alerts: presented });
});

const handleCreateAlert = requireAuth(async (request, user: User, params) => {
  if (!(await canManageAlerts(user))) return json({ error: 'Forbidden' }, 403);

  const scope = await getScopedDevice(user, params);
  if (scope instanceof Response) return scope;

  const body = await readJsonBody(request);
  const name = parseName(body?.name);
  if (!name) return json({ error: 'invalid name' }, 400);

  const logic = parseLogic(body?.logic);
  if (!logic) return json({ error: 'invalid logic' }, 400);

  const conditions = parseConditions(body?.conditions);
  if (!conditions) return json({ error: 'invalid conditions' }, 400);

  const integrationIds = parseIntegrationIds(body?.integrationIds ?? []);
  if (!integrationIds) return json({ error: 'invalid integrations' }, 400);

  const validIntegrationIds = await validateIntegrationIds(scope.scopeUuid, integrationIds);
  if (!validIntegrationIds) return json({ error: 'invalid integrations' }, 400);

  const repeatIntervalMinutes = parseRepeatInterval(body?.repeatIntervalMinutes);
  if (repeatIntervalMinutes === null) return json({ error: 'invalid repeat interval' }, 400);

  const enabled = body?.enabled === undefined ? true : body.enabled;
  if (typeof enabled !== 'boolean') return json({ error: 'invalid enabled' }, 400);

  const now = new Date();
  const alert: DeviceAlert = {
    id: crypto.randomUUID(),
    serial: scope.serial,
    teamId: scope.scopeUuid,
    name,
    enabled,
    logic,
    conditions,
    integrationIds: validIntegrationIds,
    repeatIntervalMinutes,
    firing: false,
    createdAt: now,
    updatedAt: now,
  };

  const created = await createAlert(alert);
  const stats = await getDataPointStats([scope.serial]);
  const latest = stats.get(scope.serial)?.latest ?? null;
  return json({ alert: { ...created, firing: computeFiring(created, latest) } }, 201);
});

const handleUpdateAlert = requireAuth(async (request, user: User, params) => {
  if (!(await canManageAlerts(user))) return json({ error: 'Forbidden' }, 403);

  const scope = await getScopedDevice(user, params);
  if (scope instanceof Response) return scope;

  const id = typeof params.id === 'string' ? params.id : '';
  if (!id) return json({ error: 'invalid id' }, 400);

  const existing = await getAlertById(id);
  if (!existing) return json({ error: 'not found' }, 404);
  if (existing.teamId !== scope.scopeUuid || existing.serial !== scope.serial) {
    return json({ error: 'forbidden' }, 403);
  }

  const body = await readJsonBody(request);
  const updates: Partial<DeviceAlert> = {};

  if (body?.name !== undefined) {
    const name = parseName(body.name);
    if (!name) return json({ error: 'invalid name' }, 400);
    updates.name = name;
  }

  let rulesChanged = false;
  if (body?.logic !== undefined) {
    const logic = parseLogic(body.logic);
    if (!logic) return json({ error: 'invalid logic' }, 400);
    updates.logic = logic;
    rulesChanged = true;
  }

  if (body?.conditions !== undefined) {
    const conditions = parseConditions(body.conditions);
    if (!conditions) return json({ error: 'invalid conditions' }, 400);
    updates.conditions = conditions;
    rulesChanged = true;
  }

  if (body?.integrationIds !== undefined) {
    const integrationIds = parseIntegrationIds(body.integrationIds);
    if (!integrationIds) return json({ error: 'invalid integrations' }, 400);
    const validIntegrationIds = await validateIntegrationIds(scope.scopeUuid, integrationIds);
    if (!validIntegrationIds) return json({ error: 'invalid integrations' }, 400);
    updates.integrationIds = validIntegrationIds;
  }

  if (body?.repeatIntervalMinutes !== undefined) {
    const repeatIntervalMinutes = parseRepeatInterval(body.repeatIntervalMinutes);
    if (repeatIntervalMinutes === null) return json({ error: 'invalid repeat interval' }, 400);
    updates.repeatIntervalMinutes = repeatIntervalMinutes;
  }

  if (body?.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') return json({ error: 'invalid enabled' }, 400);
    updates.enabled = body.enabled;
    if (!body.enabled) updates.firing = false;
  }

  if (rulesChanged) updates.firing = false;

  const updated = await updateAlert(id, updates);
  if (!updated) return json({ error: 'not found' }, 404);

  const stats = await getDataPointStats([scope.serial]);
  const latest = stats.get(scope.serial)?.latest ?? null;

  return json({ alert: { ...updated, firing: computeFiring(updated, latest) } });
});

const handleDeleteAlert = requireAuth(async (_request, user: User, params) => {
  if (!(await canManageAlerts(user))) return json({ error: 'Forbidden' }, 403);

  const scope = await getScopedDevice(user, params);
  if (scope instanceof Response) return scope;

  const id = typeof params.id === 'string' ? params.id : '';
  if (!id) return json({ error: 'invalid id' }, 400);

  const existing = await getAlertById(id);
  if (!existing) return json({ error: 'not found' }, 404);
  if (existing.teamId !== scope.scopeUuid || existing.serial !== scope.serial) {
    return json({ error: 'forbidden' }, 403);
  }

  const deleted = await deleteAlert(id, scope.scopeUuid);
  if (!deleted) return json({ error: 'not found' }, 404);
  return json({ deleted: true });
});

export {
  handleListAlerts as handleAlertsList,
  handleCreateAlert as handleAlertCreate,
  handleUpdateAlert as handleAlertUpdate,
  handleDeleteAlert as handleAlertDelete,
};
