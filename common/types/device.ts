import type { PaginationMeta, PaginationQuery } from './pagination';
import type { SessionLocation } from './session';

export type Device = {
  serial: number;
  name?: string;
  teamId: string;
  ownerUsername: string;
  locationId?: string;
  registeredAt: Date;
  lastUploadAt?: Date;
  metadata?: Record<string, unknown>;
};

export type DataPoint = {
  timestamp: Date;
  temperature: number;
  humidity: number;
  airPressure: number;
};

export type DeviceSummary = Device & {
  dataPointCount: number;
  latestDataPoint: DataPoint | null;
};

/** Current uninterrupted reporting streak for a device. */
export type DeviceUptime = {
  online: boolean;
  /** Start of the current streak; null when the device has no recent readings. */
  since: Date | null;
  /** Length of the current streak in milliseconds; 0 while offline. */
  durationMs: number;
};

export type DeviceToken = {
  token: string;
  expiresAt: Date;
};

export type DeviceUploadToken = {
  id: string;
  serial: number;
  teamId: string;
  tokenHash: string;
  createdAt: Date;
  lastUsedAt?: Date;
  location: SessionLocation;
  active: boolean;
  revokedAt?: Date;
  userAgent?: string;
};

export type DeviceUploadTokenInfo = Omit<DeviceUploadToken, 'tokenHash'>;

/** Short-lived device activity entries shown in the device Logs tab. */
export type DeviceLogLevel = 'info' | 'warning' | 'error';

export type DeviceLogEvent =
  | 'upload_success'
  | 'upload_error'
  | 'auth_error'
  | 'malformed_data'
  | 'rate_limited'
  | 'token_revoked';

export type DeviceLog = {
  id: string;
  /** Present once the upload has been attributed to a registered device. */
  serial?: number;
  teamId?: string;
  event: DeviceLogEvent;
  level: DeviceLogLevel;
  message: string;
  details?: Record<string, unknown>;
  createdAt: Date;
};

export type DeviceLogListQuery = PaginationQuery & {
  level?: DeviceLogLevel | 'all';
  event?: DeviceLogEvent | 'all';
  /** Case-insensitive text search over log messages and event names. */
  q?: string;
  from?: string;
  to?: string;
};

export type DeviceLogListPayload = {
  logs: DeviceLog[];
} & PaginationMeta;

// Backwards/alternate names used by callers and tests.
export type DeviceTokenInfo = DeviceUploadTokenInfo;
export type DeviceTokenSummary = DeviceUploadTokenInfo;

/**
 * A single measurement as uploaded by a device. The timestamp may be an ISO
 * 8601 string or a Unix timestamp in milliseconds; the server rounds it to the
 * nearest second before storing.
 */
export type DataPointInput = {
  timestamp: string | number;
  temperature: number;
  humidity: number;
  airPressure: number;
};

export type DeviceUploadRequest = {
  serial: number;
  name: string;
  token: string;
  data: DataPointInput[];
};

export type DeviceUploadPayload = {
  device: Device;
  accepted: number;
};

export const PAIRING_CODE_LENGTH = 6;
