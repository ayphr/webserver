import { describe, expect, test } from 'bun:test';
import type { DeviceAlert } from '@common';
import { isAlertMuted } from './alerts';

describe('alert mute state', () => {
  const now = Date.parse('2026-01-02T00:00:00.000Z');
  const alert = (mutedUntil?: Date | null) => ({
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
    mutedUntil,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  }) as DeviceAlert;

  test('suppresses delivery only while mutedUntil is in the future', () => {
    expect(isAlertMuted(alert(new Date(now + 60_000)), now)).toBe(true);
    expect(isAlertMuted(alert(new Date(now - 60_000)), now)).toBe(false);
    expect(isAlertMuted(alert(null), now)).toBe(false);
    expect(isAlertMuted(alert(), now)).toBe(false);
  });

  test('uses the current time by default', () => {
    expect(isAlertMuted(alert(new Date(Date.now() + 60_000)))).toBe(true);
    expect(isAlertMuted(alert(new Date(Date.now() - 60_000)))).toBe(false);
  });
});
