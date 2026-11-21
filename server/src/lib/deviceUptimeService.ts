import type { DeviceUptime } from '@common';
import { computeCurrentUptime } from '@common';
import { DATA_POINTS_COLLECTION, getCollection, trackMongoOperation } from './db';

/** Enough recent samples to spot the last outage without loading a whole history. */
const UPTIME_SAMPLE_SIZE = 500;

export async function getDeviceUptime(serial: number): Promise<DeviceUptime> {
  const dataPoints = await getCollection('dataPoints');
  trackMongoOperation('find', DATA_POINTS_COLLECTION);
  const docs = await dataPoints
    .find({ deviceSerial: serial }, { projection: { _id: 0, timestamp: 1 } })
    .sort({ timestamp: -1 })
    .limit(UPTIME_SAMPLE_SIZE)
    .toArray();

  return computeCurrentUptime(docs.map((doc) => doc.timestamp));
}
