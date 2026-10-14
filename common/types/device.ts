export type Device = {
  serial: number;
  name?: string;
  ownerUuid: string;
  ownerUsername: string;
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
