/* eslint-disable @typescript-eslint/no-unused-vars */

import * as internal from './internal';
import type { Collections, DataPointDocument, DeviceClaim, DeviceDocument, StoredAvatar } from './internal';
const {
  DEVICE_STATS_CACHE,
  DEVICE_STATS_CACHE_TTL_SECONDS,
  deviceStatsCacheKey,
  getCols,
  trackMongoOperation,
  DATA_POINTS_COLLECTION,
  DEVICES_COLLECTION
} = internal;

import type {
  DataPoint, Device, Punishment, Session, User, UserRole, AttachedSubscription, PaidSubscription, App, OAuthAuthorizationCode, OAuthAccessToken, Connection
} from '@common';
import { cacheDel, cacheGet, cacheSet, cacheIncr, cacheReadCounter } from '../cache';
import { invalidateAuthEntries } from '../authCache';

export async function upsertDataPoints(deviceSerial: number, points: DataPoint[]): Promise<number> {
  if (points.length === 0) return 0;

  const { dataPoints } = await getCols();
  const operations = points.map((point) => ({
    updateOne: {
      filter: { deviceSerial, timestamp: point.timestamp },
      update: {
        $set: {
          temperature: point.temperature,
          humidity: point.humidity,
          airPressure: point.airPressure,
        },
      },
      upsert: true,
    },
  }));

  trackMongoOperation('bulkWrite', DATA_POINTS_COLLECTION);
  await dataPoints.bulkWrite(operations);
  return points.length;
}


export type DataPointStats = {
  count: number;
  latest: DataPoint | null;
};


export async function getDataPointStats(
  serials: number[],
  ownerCacheKey?: string,
): Promise<Map<number, DataPointStats>> {
  if (serials.length === 0) return new Map();

  if (ownerCacheKey) {
    const cached = await cacheGet<Array<[number, DataPointStats]>>(
      DEVICE_STATS_CACHE,
      deviceStatsCacheKey(ownerCacheKey),
    );
    if (cached) return new Map(cached);
  }

  const { dataPoints } = await getCols();
  trackMongoOperation('aggregate', DATA_POINTS_COLLECTION);

  const rows = await dataPoints
    .aggregate<{ _id: number; count: number; latest: DataPointDocument }>([
      { $match: { deviceSerial: { $in: serials } } },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$deviceSerial',
          count: { $sum: 1 },
          latest: { $first: '$$ROOT' },
        },
      },
    ])
    .toArray();

  const stats = new Map<number, DataPointStats>();
  for (const row of rows) {
    stats.set(row._id, {
      count: row.count,
      latest: row.latest
        ? {
            timestamp: row.latest.timestamp,
            temperature: row.latest.temperature,
            humidity: row.latest.humidity,
            airPressure: row.latest.airPressure,
          }
        : null,
    });
  }

  if (ownerCacheKey) {
    await cacheSet(
      DEVICE_STATS_CACHE,
      deviceStatsCacheKey(ownerCacheKey),
      [...stats],
      DEVICE_STATS_CACHE_TTL_SECONDS,
    );
  }

  return stats;
}


export async function countActiveDevices(since: Date): Promise<number> {
  const { devices } = await getCols();
  trackMongoOperation('countDocuments', DEVICES_COLLECTION);
  return devices.countDocuments({ lastUploadAt: { $gte: since } });
}


export async function countDevices(): Promise<number> {
  const { devices } = await getCols();
  trackMongoOperation('countDocuments', DEVICES_COLLECTION);
  return devices.countDocuments({});
}


