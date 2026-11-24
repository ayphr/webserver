import { describe, expect, test } from 'bun:test';
import type { DeviceAlert } from '@common';
import {
  buildNotificationClaimFilter,
  claimAlertNotification,
  type AlertNotificationCollection,
} from './alerts';

const NOW = Date.parse('2026-01-02T00:00:00.000Z');

function alert(lastNotifiedAt?: Date): DeviceAlert {
  return {
    id: 'alert-1',
    serial: 42,
    teamId: 'team-1',
    name: 'High temperature',
    enabled: true,
    logic: 'and',
    conditions: [],
    integrationIds: [],
    repeatIntervalMinutes: 5,
    firing: true,
    lastNotifiedAt,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
  } as DeviceAlert;
}

/**
 * Fake that enforces the guarded filter: a claim only succeeds while the
 * stored document is enabled, not firing, or outside the repeat window.
 */
function fakeAlerts(initial: DeviceAlert) {
  let stored: DeviceAlert = { ...initial };
  const calls: Array<Record<string, unknown>> = [];
  const collection = {
    findOneAndUpdate: async (filter: Record<string, any>, update: Record<string, any>) => {
      calls.push(filter);
      const repeatCutoff = filter.$or[3].lastNotifiedAt.$lte as Date;
      const eligible = stored.enabled
        && (stored.firing !== true
          || !stored.lastNotifiedAt
          || stored.lastNotifiedAt.getTime() <= repeatCutoff.getTime());
      if (!eligible) return null;
      stored = { ...stored, ...update.$set } as DeviceAlert;
      return stored;
    },
  } as unknown as AlertNotificationCollection;
  return { collection, calls, get stored() { return stored; } };
}

describe('alert notification claim', () => {
  test('filter requires an enabled alert and a closed repeat window', () => {
    const filter = buildNotificationClaimFilter(alert(), NOW, 300_000);
    expect(filter).toMatchObject({ id: 'alert-1', enabled: true });
    expect(JSON.stringify(filter)).toContain('lastNotifiedAt');
  });

  test('concurrent evaluations only notify once per window', async () => {
    const state = fakeAlerts(alert(new Date(NOW - 600_000)));
    const fire = () => claimAlertNotification(state.collection, alert(), NOW, 300_000);

    const results = await Promise.all([fire(), fire(), fire()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(state.stored.lastNotifiedAt?.getTime()).toBe(NOW);
  });

  test('a recently notified repeating alert is not claimed again', async () => {
    const state = fakeAlerts(alert(new Date(NOW - 60_000)));
    expect(await claimAlertNotification(state.collection, alert(), NOW, 300_000)).toBe(false);
  });
});
