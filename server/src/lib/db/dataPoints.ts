import type { DataPointDocument } from './internal';
import {
  DEVICE_STATS_CACHE,
  DEVICE_STATS_CACHE_TTL_SECONDS,
  deviceStatsCacheKey,
  getCollection,
  trackMongoOperation,
  DATA_POINTS_COLLECTION,
  DEVICES_COLLECTION
} from './internal';

import type {
  DataPoint
} from '@common';
import { cacheGet, cacheSet } from '../cache';

export async function upsertDataPoints(deviceSerial: number, points: DataPoint[]): Promise<number> {
  if (points.length === 0) return 0;

  const dataPoints = await getCollection('dataPoints');
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

  const dataPoints = await getCollection('dataPoints');
  trackMongoOperation('aggregate', DATA_POINTS_COLLECTION);

  const rows = await dataPoints
    .aggregate<{ _id: number; count: number; latest: DataPointDocument }>([
      { $match: { deviceSerial: { $in: serials } } },
      {
        $group: {
          _id: '$deviceSerial',
          count: { $sum: 1 },
          latest: {
            $top: {
              output: '$$ROOT',
              sortBy: { timestamp: -1 },
            },
          },
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
  const devices = await getCollection('devices');
  trackMongoOperation('countDocuments', DEVICES_COLLECTION);
  return devices.countDocuments({ lastUploadAt: { $gte: since } });
}


export async function countDevices(): Promise<number> {
  const devices = await getCollection('devices');
  trackMongoOperation('countDocuments', DEVICES_COLLECTION);
  return devices.countDocuments({});
}

/**
 * Enforces a plan's data retention and total data point cap for the given set
 * of device serials. Data points older than `retentionCutoff` are removed, and
 * if the remaining total exceeds `maxPoints` the oldest points are deleted until
 * the cap is met. Returns the number of documents removed.
 */
export async function pruneDataPointsForSerials(
  serials: number[],
  maxPoints: number,
  retentionCutoff: Date,
): Promise<number> {
  if (serials.length === 0) return 0;

  const dataPoints = await getCollection('dataPoints');
  let removed = 0;

  trackMongoOperation('deleteMany', DATA_POINTS_COLLECTION);
  const retentionResult = await dataPoints.deleteMany({
    deviceSerial: { $in: serials },
    timestamp: { $lt: retentionCutoff },
  });
  removed += retentionResult.deletedCount ?? 0;

  trackMongoOperation('countDocuments', DATA_POINTS_COLLECTION);
  const total = await dataPoints.countDocuments({ deviceSerial: { $in: serials } });

  const excess = total - maxPoints;
  if (excess > 0) {
    trackMongoOperation('find', DATA_POINTS_COLLECTION);
    const oldest = await dataPoints
      .find({ deviceSerial: { $in: serials } }, { projection: { _id: 1 } })
      .sort({ timestamp: 1, _id: 1 })
      .limit(excess)
      .toArray();

    if (oldest.length > 0) {
      trackMongoOperation('deleteMany', DATA_POINTS_COLLECTION);
      const deleteResult = await dataPoints.deleteMany({
        _id: { $in: oldest.map((doc) => doc._id) },
      });
      removed += deleteResult.deletedCount ?? 0;
    }
  }

  return removed;
}

export async function getDataPointsForDevice(
  serial: number,
  options?: { since?: Date; until?: Date; maxPoints?: number },
): Promise<{ points: DataPoint[]; totalCount: number }> {
  const dataPoints = await getCollection('dataPoints');
  const filter: Record<string, unknown> = { deviceSerial: serial };
  if (options?.since || options?.until) {
    const tsFilter: Record<string, unknown> = {};
    if (options.since) tsFilter.$gte = options.since;
    if (options.until) tsFilter.$lte = options.until;
    filter.timestamp = tsFilter;
  }

  trackMongoOperation('countDocuments', DATA_POINTS_COLLECTION);
  const totalCount = await dataPoints.countDocuments(filter);

  if (totalCount === 0) {
    return { points: [], totalCount: 0 };
  }

  const max = options?.maxPoints ?? 1200;

  trackMongoOperation('find', DATA_POINTS_COLLECTION);
  if (totalCount <= max) {
    const docs = await dataPoints
      .find(filter, {
        projection: { _id: 0, timestamp: 1, temperature: 1, humidity: 1, airPressure: 1 },
      })
      .sort({ timestamp: 1 })
      .toArray();
    return {
      points: docs.map((doc) => ({
        timestamp: doc.timestamp,
        temperature: doc.temperature,
        humidity: doc.humidity,
        airPressure: doc.airPressure,
      })),
      totalCount,
    };
  }

  if (totalCount <= 10000) {
    const docs = await dataPoints
      .find(filter, {
        projection: { _id: 0, timestamp: 1, temperature: 1, humidity: 1, airPressure: 1 },
      })
      .sort({ timestamp: 1 })
      .toArray();
    const step = docs.length / max;
    const sampled: DataPoint[] = [];
    for (let i = 0; i < max; i++) {
      const idx = Math.min(Math.floor(i * step), docs.length - 1);
      const doc = docs[idx];
      if (doc) {
        sampled.push({
          timestamp: doc.timestamp,
          temperature: doc.temperature,
          humidity: doc.humidity,
          airPressure: doc.airPressure,
        });
      }
    }
    const lastDoc = docs[docs.length - 1];
    const lastSampled = sampled[sampled.length - 1];
    if (lastDoc && lastSampled && lastSampled.timestamp.getTime() !== lastDoc.timestamp.getTime()) {
      sampled[sampled.length - 1] = {
        timestamp: lastDoc.timestamp,
        temperature: lastDoc.temperature,
        humidity: lastDoc.humidity,
        airPressure: lastDoc.airPressure,
      };
    }
    return { points: sampled, totalCount };
  }

  const recentDocs = await dataPoints
    .find(filter, {
      projection: { _id: 0, timestamp: 1, temperature: 1, humidity: 1, airPressure: 1 },
    })
    .sort({ timestamp: -1 })
    .limit(max)
    .toArray();
  recentDocs.reverse();
  return {
    points: recentDocs.map((doc) => ({
      timestamp: doc.timestamp,
      temperature: doc.temperature,
      humidity: doc.humidity,
      airPressure: doc.airPressure,
    })),
    totalCount,
  };
}

export async function getAllDataPointsForDevice(
  serial: number,
  options?: { since?: Date; until?: Date },
): Promise<DataPoint[]> {
  const dataPoints = await getCollection('dataPoints');
  const filter: Record<string, unknown> = { deviceSerial: serial };
  if (options?.since || options?.until) {
    const tsFilter: Record<string, unknown> = {};
    if (options.since) tsFilter.$gte = options.since;
    if (options.until) tsFilter.$lte = options.until;
    filter.timestamp = tsFilter;
  }

  trackMongoOperation('find', DATA_POINTS_COLLECTION);
  const docs = await dataPoints
    .find(filter, {
      projection: { _id: 0, timestamp: 1, temperature: 1, humidity: 1, airPressure: 1 },
    })
    .sort({ timestamp: 1 })
    .toArray();
  return docs.map((doc) => ({
    timestamp: doc.timestamp,
    temperature: doc.temperature,
    humidity: doc.humidity,
    airPressure: doc.airPressure,
  }));
}


export async function deleteDataPointsForDevice(serial: number, timestamps: Date[]): Promise<number> {
  if (timestamps.length === 0) return 0;
  const dataPoints = await getCollection('dataPoints');
  trackMongoOperation('deleteMany', DATA_POINTS_COLLECTION);
  const result = await dataPoints.deleteMany({
    deviceSerial: serial,
    timestamp: { $in: timestamps },
  });
  return result.deletedCount ?? 0;
}
