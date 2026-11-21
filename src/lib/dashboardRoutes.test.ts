import { describe, expect, it } from 'bun:test';
import { dashboardPath, parseDashboardPath } from './dashboardRoutes';

describe('dashboardPath', () => {
  it('builds top-level and section URLs', () => {
    expect(dashboardPath({ tab: 'devices' })).toBe('/dashboard/devices');
    expect(dashboardPath({ tab: 'settings', section: 'iris' })).toBe('/dashboard/settings/iris');
    expect(dashboardPath({ tab: 'team', section: 'audit' })).toBe('/dashboard/team/audit');
  });

  it('builds nested device and alert URLs', () => {
    expect(dashboardPath({ tab: 'devices', device: { serial: 42 } })).toBe('/dashboard/devices/42');
    expect(dashboardPath({ tab: 'devices', device: { serial: 42, detailTab: 'graphs' } })).toBe('/dashboard/devices/42');
    expect(dashboardPath({
      tab: 'devices',
      device: { serial: 42, detailTab: 'alerts', alertAction: 'new' },
    })).toBe('/dashboard/devices/42/alerts/new');
    expect(dashboardPath({
      tab: 'devices',
      device: { serial: 42, detailTab: 'alerts', alertId: 'alert-id', alertAction: 'edit' },
    })).toBe('/dashboard/devices/42/alerts/alert-id/edit');
  });
});

describe('parseDashboardPath', () => {
  it('parses canonical paths', () => {
    expect(parseDashboardPath('/dashboard/settings/iris')).toMatchObject({
      tab: 'settings',
      section: 'iris',
      canonicalPath: '/dashboard/settings/iris',
      valid: true,
    });
    expect(parseDashboardPath('/dashboard/devices/42/alerts/alert-id/edit')).toMatchObject({
      tab: 'devices',
      device: { serial: 42, detailTab: 'alerts', alertId: 'alert-id', alertAction: 'edit' },
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
});
