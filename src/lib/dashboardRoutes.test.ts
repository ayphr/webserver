import { describe, expect, it } from 'bun:test';
import { dashboardPath, parseDashboardPath } from './dashboardRoutes';

describe('dashboardPath', () => {
  it('builds top-level and section URLs', () => {
    expect(dashboardPath({ tab: 'devices' })).toBe('/dashboard/devices');
    expect(dashboardPath({ tab: 'queries' })).toBe('/dashboard/queries');
    expect(dashboardPath({ tab: 'settings', section: 'iris' })).toBe('/dashboard/settings/iris');
    expect(dashboardPath({ tab: 'team', section: 'audit' })).toBe('/dashboard/team/audit');
  });

  it('builds nested device and alert URLs', () => {
    expect(dashboardPath({ tab: 'devices', device: { serial: 42 } })).toBe('/dashboard/devices/42');
    expect(dashboardPath({ tab: 'devices', device: { serial: 42, detailTab: 'graphs' } })).toBe('/dashboard/devices/42');
    expect(dashboardPath({ tab: 'devices', device: { serial: 42, detailTab: 'logs' } })).toBe('/dashboard/devices/42/logs');
    expect(dashboardPath({
      tab: 'devices',
      device: { serial: 42, detailTab: 'alerts', alertAction: 'new' },
    })).toBe('/dashboard/devices/42/alerts/new');
    expect(dashboardPath({
      tab: 'devices',
      device: { serial: 42, detailTab: 'alerts', alertId: 'alert-id', alertAction: 'edit' },
    })).toBe('/dashboard/devices/42/alerts/alert-id/edit');
  });

  it('builds canonical location URLs', () => {
    expect(dashboardPath({ tab: 'locations' })).toBe('/dashboard/locations');
    expect(dashboardPath({ tab: 'locations', location: { id: 'home' } })).toBe('/dashboard/locations/home');
    expect(dashboardPath({ tab: 'locations', location: { id: 'home', detailTab: 'overview' } })).toBe('/dashboard/locations/home');
    expect(dashboardPath({ tab: 'locations', location: { id: 'home', detailTab: 'settings' } })).toBe('/dashboard/locations/home/settings');
    expect(dashboardPath({ tab: 'locations', location: { id: 'my place/1', detailTab: 'settings' } })).toBe('/dashboard/locations/my%20place%2F1/settings');
  });

  it('builds assistant chat URLs', () => {
    expect(dashboardPath({ tab: 'assistant' })).toBe('/dashboard/assistant');
    expect(dashboardPath({ tab: 'assistant', assistant: { chatId: 'chat-1' } })).toBe('/dashboard/assistant/chat/chat-1');
    expect(dashboardPath({ tab: 'assistant', assistant: { chatId: 'my chat/1' } })).toBe('/dashboard/assistant/chat/my%20chat%2F1');
  });

  it('builds profile, game and staff user URLs', () => {
    expect(dashboardPath({ tab: 'profile' })).toBe('/dashboard/profile');
    expect(dashboardPath({ tab: 'profile', profileEdit: true })).toBe('/dashboard/profile/edit');
    expect(dashboardPath({ tab: 'games', game: 'memory' })).toBe('/dashboard/games/memory');
    expect(dashboardPath({ tab: 'users', staffUser: { uuid: 'u1' } })).toBe('/dashboard/users/u1');
    expect(dashboardPath({ tab: 'users', staffUser: { uuid: 'u1', tab: 'overview' } })).toBe('/dashboard/users/u1');
    expect(dashboardPath({ tab: 'users', staffUser: { uuid: 'my user/1', tab: 'actions' } })).toBe('/dashboard/users/my%20user%2F1/actions');
  });
});

describe('parseDashboardPath', () => {
  it('parses canonical paths', () => {
    expect(parseDashboardPath('/dashboard/queries')).toMatchObject({
      tab: 'queries',
      canonicalPath: '/dashboard/queries',
      valid: true,
    });
    expect(parseDashboardPath('/dashboard/settings/iris')).toMatchObject({
      tab: 'settings',
      section: 'iris',
      canonicalPath: '/dashboard/settings/iris',
      valid: true,
    });
    expect(parseDashboardPath('/dashboard/devices/42/logs')).toMatchObject({
      tab: 'devices',
      device: { serial: 42, detailTab: 'logs' },
      canonicalPath: '/dashboard/devices/42/logs',
      valid: true,
    });
    expect(parseDashboardPath('/dashboard/devices/42/alerts/alert-id/edit')).toMatchObject({
      tab: 'devices',
      device: { serial: 42, detailTab: 'alerts', alertId: 'alert-id', alertAction: 'edit' },
      valid: true,
    });
    expect(parseDashboardPath('/dashboard/locations')).toMatchObject({
      tab: 'locations',
      canonicalPath: '/dashboard/locations',
      valid: true,
    });
    expect(parseDashboardPath('/dashboard/locations/home')).toMatchObject({
      tab: 'locations',
      location: { id: 'home' },
      canonicalPath: '/dashboard/locations/home',
      valid: true,
    });
    expect(parseDashboardPath('/dashboard/locations/home/settings')).toMatchObject({
      tab: 'locations',
      location: { id: 'home', detailTab: 'settings' },
      canonicalPath: '/dashboard/locations/home/settings',
      valid: true,
    });
    expect(parseDashboardPath('/dashboard/locations/my%20place%2F1/settings')).toMatchObject({
      tab: 'locations',
      location: { id: 'my place/1', detailTab: 'settings' },
      canonicalPath: '/dashboard/locations/my%20place%2F1/settings',
      valid: true,
    });
    // Explicit default sections normalize to the shorter canonical URL.
    expect(parseDashboardPath('/dashboard/locations/home/overview')).toMatchObject({
      tab: 'locations',
      location: { id: 'home', detailTab: 'overview' },
      canonicalPath: '/dashboard/locations/home',
      valid: true,
    });
    expect(parseDashboardPath('/dashboard/assistant')).toMatchObject({
      tab: 'assistant',
      canonicalPath: '/dashboard/assistant',
      valid: true,
    });
    expect(parseDashboardPath('/dashboard/assistant/chat/chat-1')).toMatchObject({
      tab: 'assistant',
      assistant: { chatId: 'chat-1' },
      canonicalPath: '/dashboard/assistant/chat/chat-1',
      valid: true,
    });
    expect(parseDashboardPath('/dashboard/assistant/chat/my%20chat%2F1')).toMatchObject({
      tab: 'assistant',
      assistant: { chatId: 'my chat/1' },
      valid: true,
    });
    expect(parseDashboardPath('/dashboard/profile')).toMatchObject({
      tab: 'profile',
      canonicalPath: '/dashboard/profile',
      valid: true,
    });
    expect(parseDashboardPath('/dashboard/profile/edit')).toMatchObject({
      tab: 'profile',
      profileEdit: true,
      canonicalPath: '/dashboard/profile/edit',
      valid: true,
    });
    expect(parseDashboardPath('/dashboard/games/memory')).toMatchObject({
      tab: 'games',
      game: 'memory',
      canonicalPath: '/dashboard/games/memory',
      valid: true,
    });
    expect(parseDashboardPath('/dashboard/users/my%20user%2F1/actions')).toMatchObject({
      tab: 'users',
      staffUser: { uuid: 'my user/1', tab: 'actions' },
      canonicalPath: '/dashboard/users/my%20user%2F1/actions',
      valid: true,
    });
    expect(parseDashboardPath('/dashboard/users/u1/overview')).toMatchObject({
      tab: 'users',
      staffUser: { uuid: 'u1' },
      canonicalPath: '/dashboard/users/u1',
      valid: true,
    });
  });

  it('supports legacy query-string tabs', () => {
    expect(parseDashboardPath('/dashboard', 'devices')).toMatchObject({
      tab: 'devices',
      canonicalPath: '/dashboard/devices',
      valid: false,
    });
    expect(parseDashboardPath('/dashboard', 'account-settings')).toMatchObject({
      tab: 'settings',
      canonicalPath: '/dashboard/settings',
      valid: false,
    });
  });

  it('rejects invalid device and team paths', () => {
    expect(parseDashboardPath('/dashboard/devices/not-a-serial')).toMatchObject({
      tab: 'devices',
      canonicalPath: '/dashboard/devices',
      valid: false,
    });
    expect(parseDashboardPath('/dashboard/team/unknown')).toMatchObject({
      tab: 'team',
      canonicalPath: '/dashboard/team',
      valid: false,
    });
  });

  it('rejects invalid location paths', () => {
    expect(parseDashboardPath('/dashboard/locations/home/unknown')).toMatchObject({
      tab: 'locations',
      canonicalPath: '/dashboard/locations/home',
      valid: false,
    });
    expect(parseDashboardPath('/dashboard/locations/home/history/extra')).toMatchObject({
      tab: 'locations',
      canonicalPath: '/dashboard/locations/home',
      valid: false,
    });
    expect(parseDashboardPath('/dashboard/locations/%E0%A4%A')).toMatchObject({
      tab: 'locations',
      canonicalPath: '/dashboard/locations',
      valid: false,
    });
  });

  it('rejects invalid assistant paths', () => {
    expect(parseDashboardPath('/dashboard/assistant/unknown')).toMatchObject({
      tab: 'assistant',
      canonicalPath: '/dashboard/assistant',
      valid: false,
    });
    expect(parseDashboardPath('/dashboard/assistant/chat')).toMatchObject({
      tab: 'assistant',
      canonicalPath: '/dashboard/assistant',
      valid: false,
    });
    expect(parseDashboardPath('/dashboard/assistant/chat/chat-1/extra')).toMatchObject({
      tab: 'assistant',
      canonicalPath: '/dashboard/assistant',
      valid: false,
    });
  });

  it('rejects invalid profile, game and staff user paths', () => {
    expect(parseDashboardPath('/dashboard/profile/unknown')).toMatchObject({
      tab: 'profile',
      canonicalPath: '/dashboard/profile',
      valid: false,
    });
    expect(parseDashboardPath('/dashboard/games/unknown')).toMatchObject({
      tab: 'games',
      canonicalPath: '/dashboard/games',
      valid: false,
    });
    expect(parseDashboardPath('/dashboard/users/u1/unknown')).toMatchObject({
      tab: 'users',
      canonicalPath: '/dashboard/users/u1',
      valid: false,
    });
  });
});
