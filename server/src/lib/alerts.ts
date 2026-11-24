import type {
  AlertCondition,
  AlertLogic,
  AlertMetric,
  AlertTestResult,
  DataPoint,
  DeviceAlert,
  Integration,
} from '@common';
import { evaluateAlertConditions } from '@common';
import { getAlertsForSerial, getIntegrationsForTeamId, updateAlert } from './db';
import { getCollection, trackMongoOperation, ALERTS_COLLECTION } from './db/internal';
import type { DeviceDocument } from './db';
import { getTeamById } from './db/teams';
import { teamSupportsAlertsAndWebhooks } from './planAccess';
import { createLogger } from './logger';
import { postToPinnedWebhook } from './webhookUrl';

const log = createLogger('alerts');

const METRIC_LABELS: Record<AlertMetric, string> = {
  temperature: 'Temperature',
  humidity: 'Humidity',
  airPressure: 'Pressure',
};

const METRIC_UNITS: Record<AlertMetric, string> = {
  temperature: '°C',
  humidity: '%',
  airPressure: 'hPa',
};

const WEBHOOK_TIMEOUT_MS = 10_000;

/** Minimal collection seam for the atomic notification claim. */
export type AlertNotificationCollection = {
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ): Promise<unknown>;
};

/**
 * Only one concurrent telemetry upload may win the right to notify for an
 * alert window. A newly firing alert bypasses the repeat interval, otherwise
 * the previous notification must be at least one repeat interval old.
 */
export function buildNotificationClaimFilter(
  alert: DeviceAlert,
  now: number,
  repeatMs: number,
): Record<string, unknown> {
  return {
    id: alert.id,
    enabled: true,
    $or: [
      { firing: { $ne: true } },
      { lastNotifiedAt: { $exists: false } },
      { lastNotifiedAt: null },
      { lastNotifiedAt: { $lte: new Date(now - repeatMs) } },
    ],
  };
}

export async function claimAlertNotification(
  alerts: AlertNotificationCollection,
  alert: DeviceAlert,
  now: number,
  repeatMs: number,
): Promise<boolean> {
  trackMongoOperation('findOneAndUpdate', ALERTS_COLLECTION);
  const claimed = await alerts.findOneAndUpdate(
    buildNotificationClaimFilter(alert, now, repeatMs),
    { $set: { lastNotifiedAt: new Date(now), updatedAt: new Date(now) } },
  );
  return claimed !== null && claimed !== undefined;
}

/** A muted alert keeps its firing state but does not deliver notifications. */
export function isAlertMuted(alert: DeviceAlert, now = Date.now()): boolean {
  if (!alert.mutedUntil) return false;
  const mutedUntilMs = new Date(alert.mutedUntil).getTime();
  return Number.isFinite(mutedUntilMs) && mutedUntilMs > now;
}

export function describeAlertConditions(conditions: AlertCondition[], logic: AlertLogic): string {
  return conditions
    .map(
      (condition) =>
        `${METRIC_LABELS[condition.metric]} ${condition.operator === 'lt' ? 'below' : 'above'} ${condition.value} ${METRIC_UNITS[condition.metric]}`,
    )
    .join(logic === 'and' ? ' and ' : ' or ');
}

function readingSummary(reading: DataPoint): string {
  return [
    `Temperature ${reading.temperature.toFixed(1)} °C`,
    `Humidity ${reading.humidity.toFixed(1)} %`,
    `Pressure ${reading.airPressure.toFixed(0)} hPa`,
  ].join(' · ');
}

function buildPayload(
  integration: Integration,
  alert: DeviceAlert,
  device: DeviceDocument,
  reading: DataPoint,
): unknown {
  const deviceName = device.name?.trim() || `Device ${device.serial}`;
  const summary = describeAlertConditions(alert.conditions, alert.logic);
  const message = [
    `Alert: ${alert.name}`,
    `${deviceName} (#${device.serial})`,
    summary,
    `Current reading: ${readingSummary(reading)}`,
    `Triggered: ${new Date().toUTCString()}`,
  ].join('\n');

  if (integration.provider === 'slack') {
    return { text: message };
  }

  if (integration.provider === 'discord') {
    return { content: message };
  }

  return {
    event: 'device_alert',
    alert: {
      id: alert.id,
      name: alert.name,
      logic: alert.logic,
      conditions: alert.conditions,
      repeatIntervalMinutes: alert.repeatIntervalMinutes,
    },
    device: {
      serial: device.serial,
      name: device.name,
    },
    reading,
    message,
  };
}

type DeliveryResult = Omit<AlertTestResult, 'integrationId'>;

async function sendToIntegration(
  integration: Integration,
  alert: DeviceAlert,
  device: DeviceDocument,
  reading: DataPoint,
): Promise<DeliveryResult> {
  // Revalidate at send time and connect to the validated IP. Stored
  // integrations may be stale or their DNS may have been rebound since they
  // were created.
  const result = await postToPinnedWebhook(integration.webhookUrl, JSON.stringify(buildPayload(integration, alert, device, reading)), {
    timeoutMs: WEBHOOK_TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json' },
  });

  if (!result.ok) {
    log.warn(
      { integrationId: integration.id, alertId: alert.id, reason: result.reason, status: result.status },
      'alert webhook delivery rejected or failed',
    );
    return { ok: false, error: result.reason, ...(result.status !== undefined ? { status: result.status } : {}) };
  }
  return { ok: true, status: result.status };
}

/**
 * Sends the exact payload a real alert would send to each enabled integration
 * configured on the alert, without changing any alert state.
 */
export async function sendTestAlert(
  alert: DeviceAlert,
  device: DeviceDocument,
  reading: DataPoint,
  integrations: Integration[],
): Promise<AlertTestResult[]> {
  const enabledById = new Map(
    integrations.filter((integration) => integration.enabled).map((integration) => [integration.id, integration]),
  );
  const targets = alert.integrationIds
    .map((id) => enabledById.get(id))
    .filter((integration): integration is Integration => Boolean(integration));

  return Promise.all(
    targets.map(async (integration) => ({
      integrationId: integration.id,
      ...(await sendToIntegration(integration, alert, device, reading)),
    })),
  );
}

/**
 * Evaluates every enabled alert for a device against its newest uploaded
 * reading. A notification is sent immediately when the alert starts firing and
 * then repeated according to the alert's repeat interval while it stays firing.
 */
export async function evaluateAlertsForDevice(
  device: DeviceDocument,
  points: DataPoint[],
): Promise<void> {
  if (points.length === 0) return;

  const latest = points.reduce((current, point) =>
    new Date(point.timestamp).getTime() > new Date(current.timestamp).getTime() ? point : current,
  );

  const alerts = await getAlertsForSerial(device.serial, device.teamId);
  if (alerts.length === 0) return;

  // A downgraded team may still have stale alerts; never deliver webhooks for them.
  const team = await getTeamById(device.teamId);
  if (!teamSupportsAlertsAndWebhooks(team)) return;

  const needsIntegrations = alerts.some((alert) => alert.enabled && alert.integrationIds.length > 0);
  const integrations = needsIntegrations ? await getIntegrationsForTeamId(device.teamId) : [];
  const integrationsById = new Map(integrations.map((integration) => [integration.id, integration]));

  const now = Date.now();

  await Promise.all(
    alerts.map(async (alert) => {
      if (!alert.enabled) {
        if (alert.firing) await updateAlert(alert.id, { firing: false });
        return;
      }

      const firing = evaluateAlertConditions(alert.conditions, alert.logic, latest);
      const wasFiring = alert.firing;
      const muted = isAlertMuted(alert, now);
      const lastNotifiedAt = alert.lastNotifiedAt ? new Date(alert.lastNotifiedAt).getTime() : 0;
      const repeatMs = Math.max(1, alert.repeatIntervalMinutes) * 60_000;

      const targets = alert.integrationIds
        .map((id) => integrationsById.get(id))
        .filter((integration): integration is Integration => Boolean(integration?.enabled));

      // Only mark the alert as notified when there is an enabled destination to
      // deliver to, so wiring up an integration later still sends immediately.
      const due = firing
        && !muted
        && targets.length > 0
        && (!wasFiring || !lastNotifiedAt || now - lastNotifiedAt >= repeatMs);

      // Claim the notification window before changing firing state or sending:
      // concurrent uploads race on a guarded findOneAndUpdate and only one
      // wins the right to deliver for this window.
      let claimed = false;
      if (due) {
        const alertsCollection = await getCollection('alerts') as unknown as AlertNotificationCollection;
        claimed = await claimAlertNotification(alertsCollection, alert, now, repeatMs);
      }

      const updates: Partial<DeviceAlert> = {};
      if (firing !== wasFiring) updates.firing = firing;
      if (firing && !wasFiring) updates.lastTriggeredAt = new Date(now);
      // lastNotifiedAt is owned by the claim above, never written by updateAlert.
      if (Object.keys(updates).length > 0) {
        await updateAlert(alert.id, updates);
      }

      if (!claimed) return;

      await Promise.all(
        targets.map((integration) => sendToIntegration(integration, alert, device, latest)),
      );
    }),
  );
}
