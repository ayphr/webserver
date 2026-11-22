import type {
  AlertCondition,
  AlertLogic,
  AlertMetric,
  DataPoint,
  DeviceAlert,
  Integration,
} from '@common';
import { evaluateAlertConditions } from '@common';
import { getAlertsForSerial, getIntegrationsForTeamId, updateAlert } from './db';
import type { DeviceDocument } from './db';
import { getTeamById } from './db/teams';
import { teamSupportsAlertsAndWebhooks } from './planAccess';
import { createLogger } from './logger';
import { validateWebhookUrl } from './webhookUrl';

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

async function sendToIntegration(
  integration: Integration,
  alert: DeviceAlert,
  device: DeviceDocument,
  reading: DataPoint,
): Promise<void> {
  // Stored integrations may predate URL validation or have a hostname that now
  // resolves to a restricted address; never fetch an unsafe destination.
  const urlCheck = await validateWebhookUrl(integration.webhookUrl);
  if (!urlCheck.ok) {
    log.warn(
      { integrationId: integration.id, alertId: alert.id, reason: urlCheck.reason },
      'skipping unsafe alert webhook url',
    );
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(urlCheck.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload(integration, alert, device, reading)),
      signal: controller.signal,
      redirect: 'error',
    });

    if (!response.ok) {
      log.warn(
        { integrationId: integration.id, alertId: alert.id, status: response.status },
        'alert webhook returned an error status',
      );
    }
  } catch (error) {
    log.warn(
      { error, integrationId: integration.id, alertId: alert.id },
      'failed to deliver alert webhook',
    );
  } finally {
    clearTimeout(timeout);
  }
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
      const lastNotifiedAt = alert.lastNotifiedAt ? new Date(alert.lastNotifiedAt).getTime() : 0;
      const repeatMs = Math.max(1, alert.repeatIntervalMinutes) * 60_000;

      const targets = alert.integrationIds
        .map((id) => integrationsById.get(id))
        .filter((integration): integration is Integration => Boolean(integration?.enabled));

      // Only mark the alert as notified when there is an enabled destination to
      // deliver to, so wiring up an integration later still sends immediately.
      const due = firing
        && targets.length > 0
        && (!wasFiring || !lastNotifiedAt || now - lastNotifiedAt >= repeatMs);

      const updates: Partial<DeviceAlert> = {};
      if (firing !== wasFiring) updates.firing = firing;
      if (firing && !wasFiring) updates.lastTriggeredAt = new Date(now);
      if (due) updates.lastNotifiedAt = new Date(now);

      if (Object.keys(updates).length > 0) {
        await updateAlert(alert.id, updates);
      }

      if (!due) return;

      await Promise.all(
        targets.map((integration) => sendToIntegration(integration, alert, device, latest)),
      );
    }),
  );
}
