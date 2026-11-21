/**
 * Canonical dashboard URLs. The dashboard keeps its tab state in the pathname
 * instead of `?tab=`, so deep links can address a device, a device section and
 * even a specific alert form.
 */

export const DASHBOARD_TABS = [
  'overview',
  'devices',
  'locations',
  'games',
  'radio',
  'assistant',
  'profile',
  'settings',
  'notifications',
  'credits',
  'users',
  'team',
  'integrations',
  'appeal',
  'appeals',
] as const;

export type DashboardTab = (typeof DASHBOARD_TABS)[number];

export const DEVICE_DETAIL_TABS = ['graphs', 'forecasts', 'alerts', 'tokens', 'logs', 'settings'] as const;
export type DeviceDetailTab = (typeof DEVICE_DETAIL_TABS)[number];

export const TEAM_SECTIONS = ['members', 'usage', 'audit', 'settings'] as const;
export type TeamSection = (typeof TEAM_SECTIONS)[number];

export type AlertRouteAction = 'new' | 'edit';

export type DeviceRouteState = {
  /** Devices are identified by their numeric serial; the URL segment acts as their id. */
  serial: number;
  detailTab?: DeviceDetailTab;
  alertId?: string;
  alertAction?: AlertRouteAction;
};

export type DashboardTarget = {
  tab: DashboardTab;
  device?: DeviceRouteState;
  /** Settings section id or team section id, depending on `tab`. */
  section?: string;
};

export type ParsedDashboardRoute = DashboardTarget & {
  canonicalPath: string;
  /** False for unknown paths, which callers can normalize to the canonical path. */
  valid: boolean;
};

const TAB_SET: ReadonlySet<string> = new Set(DASHBOARD_TABS);
const DETAIL_TAB_SET: ReadonlySet<string> = new Set(DEVICE_DETAIL_TABS);
const TEAM_SECTION_SET: ReadonlySet<string> = new Set(TEAM_SECTIONS);

/** Legacy query-string tabs and internal aliases mapped to canonical sections. */
const LEGACY_TAB_PATHS: Record<string, string> = {
  'account-settings': '/dashboard/settings',
  'team-audit': '/dashboard/team/audit',
  subscription: '/dashboard/credits',
};

export function tabToPath(tab: string): string {
  if (tab === 'account-settings') return LEGACY_TAB_PATHS[tab]!;
  if (tab === 'team-audit') return LEGACY_TAB_PATHS[tab]!;
  if (tab === 'subscription') return LEGACY_TAB_PATHS[tab]!;
  return TAB_SET.has(tab) ? `/dashboard/${tab}` : '/dashboard';
}

export function dashboardPath(target: DashboardTarget): string {
  if (target.tab === 'devices' && target.device) {
    const { serial, detailTab, alertId, alertAction } = target.device;
    let path = `/dashboard/devices/${serial}`;
    if (detailTab && detailTab !== 'graphs') {
      path += `/${detailTab}`;
      if (detailTab === 'alerts') {
        if (alertAction === 'new') {
          path += '/new';
        } else if (alertId) {
          path += `/${encodeURIComponent(alertId)}/edit`;
        }
      }
    }
    return path;
  }

  if (target.tab === 'settings' && target.section) {
    return `/dashboard/settings/${encodeURIComponent(target.section)}`;
  }

  if (target.tab === 'team' && target.section) {
    return `/dashboard/team/${encodeURIComponent(target.section)}`;
  }

  return tabToPath(target.tab);
}

function invalid(target: DashboardTarget, canonicalPath: string): ParsedDashboardRoute {
  return { ...target, canonicalPath, valid: false };
}

function parseDeviceParts(parts: string[]): ParsedDashboardRoute {
  const rawSerial = parts[1];
  const serial = rawSerial === undefined ? Number.NaN : Number(rawSerial);

  if (!Number.isSafeInteger(serial) || serial <= 0) {
    return invalid({ tab: 'devices' }, '/dashboard/devices');
  }

  const base: DeviceRouteState = { serial };
  const detail = parts[2];
  if (detail === undefined) {
    return { tab: 'devices', device: base, canonicalPath: dashboardPath({ tab: 'devices', device: base }), valid: true };
  }
  if (!DETAIL_TAB_SET.has(detail)) {
    return invalid({ tab: 'devices', device: base }, dashboardPath({ tab: 'devices', device: base }));
  }

  const device: DeviceRouteState = { serial, detailTab: detail as DeviceDetailTab };

  if (detail === 'alerts') {
    const alertPart = parts[3];
    if (alertPart === undefined) {
      return { tab: 'devices', device, canonicalPath: dashboardPath({ tab: 'devices', device }), valid: true };
    }
    if (alertPart === 'new' && parts.length === 4) {
      device.alertAction = 'new';
      return { tab: 'devices', device, canonicalPath: dashboardPath({ tab: 'devices', device }), valid: true };
    }
    const action = parts[4];
    if (parts.length <= 5 && (!action || action === 'edit')) {
      device.alertId = alertPart;
      device.alertAction = 'edit';
      return { tab: 'devices', device, canonicalPath: dashboardPath({ tab: 'devices', device }), valid: true };
    }
  } else if (parts.length === 3) {
    return { tab: 'devices', device, canonicalPath: dashboardPath({ tab: 'devices', device }), valid: true };
  }

  return invalid(
    { tab: 'devices', device: base },
    dashboardPath({ tab: 'devices', device: base }),
  );
}

/** Parses both canonical dashboard paths and legacy `?tab=` links. */
export function parseDashboardPath(pathname: string, legacyTab?: string | null): ParsedDashboardRoute {
  const path = pathname.replace(/\/+$/, '') || '/dashboard';
  const parts = path.startsWith('/dashboard')
    ? path.slice('/dashboard'.length).split('/').filter(Boolean)
    : [];

  if (parts.length === 0) {
    if (!legacyTab) {
      return { tab: 'overview', canonicalPath: '/dashboard', valid: true };
    }
    const canonicalPath = LEGACY_TAB_PATHS[legacyTab] ?? dashboardPath({
      tab: TAB_SET.has(legacyTab) ? (legacyTab as DashboardTab) : 'overview',
    });
    const tab = LEGACY_TAB_PATHS[legacyTab]
      ? parseDashboardPath(canonicalPath).tab
      : (TAB_SET.has(legacyTab) ? (legacyTab as DashboardTab) : 'overview');
    return { tab, canonicalPath, valid: canonicalPath === '/dashboard' };
  }

  const head = parts[0]!;

  if (head === 'devices') return parseDeviceParts(parts);

  if (head === 'settings') {
    const section = parts[1];
    const target: DashboardTarget = { tab: 'settings', ...(section ? { section } : {}) };
    return { ...target, canonicalPath: dashboardPath(target), valid: parts.length <= 2 };
  }

  if (head === 'team') {
    const section = parts[1];
    if (section && !TEAM_SECTION_SET.has(section)) {
      return invalid({ tab: 'team' }, '/dashboard/team');
    }
    const target: DashboardTarget = { tab: 'team', ...(section ? { section: section as TeamSection } : {}) };
    return { ...target, canonicalPath: dashboardPath(target), valid: parts.length <= 2 };
  }

  if (LEGACY_TAB_PATHS[head]) {
    const parsed = parseDashboardPath(LEGACY_TAB_PATHS[head]!);
    return { ...parsed, valid: false };
  }

  if (TAB_SET.has(head) && parts.length === 1) {
    const tab = head as DashboardTab;
    return { tab, canonicalPath: `/dashboard/${tab}`, valid: true };
  }

  return invalid({ tab: 'overview' }, '/dashboard');
}
