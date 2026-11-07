import type { DeviceSummary } from '@common';
import { toDate } from './date';

export const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

export function isDeviceOnline(device: DeviceSummary): boolean {
  if (!device.lastUploadAt) return false;
  return Date.now() - toDate(device.lastUploadAt).getTime() <= ONLINE_THRESHOLD_MS;
}

export function formatDeviceRelativeTime(value: Date | string | undefined): string {
  if (!value) return 'Never';
  const diffSecs = Math.floor((Date.now() - toDate(value).getTime()) / 1000);
  if (diffSecs < 10) return 'Just now';
  if (diffSecs < 60) return `${diffSecs}s ago`;
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}
