import { describe, expect, test } from 'bun:test';
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from '@common';
import {
  buildPushPayload,
  coerceNotificationPreferences,
  isNotificationEnabled,
  mergeNotificationPreferences,
  parseNotificationPreferencesUpdate,
  toInternalPushUrl,
} from './notifications';

describe('notification preferences', () => {
  test('coerces a complete stored document and ignores an optional types map', () => {
    const preferences = coerceNotificationPreferences({
      inApp: false,
      email: true,
      push: false,
      types: { login: false },
    });

    expect(preferences).toEqual({
      inApp: false,
      email: true,
      push: false,
      types: { login: false },
    });
    expect(coerceNotificationPreferences({ inApp: true, email: true, push: true })).toEqual({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      types: {},
    });
  });

  test('rejects missing or invalid documents', () => {
    expect(coerceNotificationPreferences(null)).toBeNull();
    expect(coerceNotificationPreferences({ inApp: true, email: true })).toBeNull();
    expect(coerceNotificationPreferences({ inApp: true, email: true, push: 'yes' })).toBeNull();
    expect(coerceNotificationPreferences({
      inApp: true,
      email: true,
      push: true,
      types: { unknown: false },
    })).toBeNull();
  });

  test('parses strict preference updates and rejects unknown fields', () => {
    expect(parseNotificationPreferencesUpdate({
      email: false,
      types: { login: false, system: true },
    })).toEqual({ email: false, types: { login: false, system: true } });
    expect(parseNotificationPreferencesUpdate({})).toEqual({});

    expect(() => parseNotificationPreferencesUpdate({ inApp: 'false' })).toThrow();
    expect(() => parseNotificationPreferencesUpdate({ unknown: true })).toThrow();
    expect(() => parseNotificationPreferencesUpdate({ types: { nope: true } })).toThrow();
    expect(() => parseNotificationPreferencesUpdate({ types: { login: 1 } })).toThrow();
    expect(() => parseNotificationPreferencesUpdate([])).toThrow();
  });

  test('merges partial updates without losing existing overrides', () => {
    const current: NotificationPreferences = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      push: false,
      types: { login: false },
    };

    expect(mergeNotificationPreferences(current, { inApp: false, types: { team: false } })).toEqual({
      inApp: false,
      email: true,
      push: false,
      types: { login: false, team: false },
    });
  });

  test('channels gate delivery and per-type overrides can mute a type', () => {
    const preferences: NotificationPreferences = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      inApp: false,
      types: { login: false, system: true },
    };

    expect(isNotificationEnabled(preferences, 'inApp', 'login')).toBe(false);
    expect(isNotificationEnabled(preferences, 'inApp', 'team')).toBe(false);
    expect(isNotificationEnabled(preferences, 'email', 'login')).toBe(false);
    expect(isNotificationEnabled(preferences, 'email', 'system')).toBe(true);
    expect(isNotificationEnabled(preferences, 'push', 'team')).toBe(true);
  });
});

describe('push payload URLs', () => {
  test('accepts only internal paths', () => {
    expect(toInternalPushUrl('/dashboard/notifications?tab=all')).toBe('/dashboard/notifications?tab=all');
    expect(toInternalPushUrl(undefined)).toBe('/dashboard/notifications');
    expect(toInternalPushUrl('https://example.com/phish')).toBe('/dashboard/notifications');
    expect(toInternalPushUrl('//example.com/phish')).toBe('/dashboard/notifications');
  });

  test('uses the notification title and message for push display', () => {
    const payload = JSON.parse(buildPushPayload({
      userUuid: 'user-1',
      type: 'assistant_task',
      title: 'Iris',
      message: 'Iris has finished responding.',
      link: '/dashboard/assistant/chat/chat-1',
    }));

    expect(payload.title).toBe('Iris');
    expect(payload.body).toBe('Iris has finished responding.');
    expect(payload.url).toBe('/dashboard/assistant/chat/chat-1');
  });
});
