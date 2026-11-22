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
    expect(dashboardPath({ tab: 'locations', location: { id: 'home', detailTab: 'history' } })).toBe('/dashboard/locations/home/history');
    expect(dashboardPath({ tab: 'locations', location: { id: 'my place/1', detailTab: 'settings' } })).toBe('/dashboard/locations/my%20place%2F1/settings');
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
    expect(parseDashboardPath('/dashboard/locations/home/history')).toMatchObject({
      tab: 'locations',
      location: { id: 'home', detailTab: 'history' },
      canonicalPath: '/dashboard/locations/home/history',
      valid: true,
    });
    expect(parseDashboardPath('/dashboard/locations/my%20place%2F1/history')).toMatchObject({
      tab: 'locations',
      location: { id: 'my place/1', detailTab: 'history' },
      canonicalPath: '/dashboard/locations/my%20place%2F1/history',
      valid: true,
    });
    // Explicit default sections normalize to the shorter canonical URL.
    expect(parseDashboardPath('/dashboard/locations/home/overview')).toMatchObject({
      tab: 'locations',
      location: { id: 'home', detailTab: 'overview' },
      canonicalPath: '/dashboard/locations/home',
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
});
