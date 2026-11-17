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
