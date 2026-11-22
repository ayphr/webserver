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
import { buildDataPointFilter } from './dataPointFilters';
import { sampleDataPoints, sortDataPoints, toDataPoint } from './dataPointSampling';

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
  const result = await dataPoints.bulkWrite(operations);
  return (result.upsertedCount ?? 0) + (result.modifiedCount ?? 0);
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
      latest: row.latest ? toDataPoint(row.latest) : null,
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

export async function countDataPointsSince(since: Date): Promise<number> {
  const dataPoints = await getCollection('dataPoints');
  trackMongoOperation('countDocuments', DATA_POINTS_COLLECTION);
  return dataPoints.countDocuments({ timestamp: { $gte: since } });
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

export async function countDataPointsForDevice(
  serial: number,
  options?: { since?: Date; until?: Date },
): Promise<number> {
  const dataPoints = await getCollection('dataPoints');
  const filter = buildDataPointFilter(serial, options);

  trackMongoOperation('countDocuments', DATA_POINTS_COLLECTION);
  return dataPoints.countDocuments(filter);
}

export async function getDataPointsForDevice(
  serial: number,
  options?: { since?: Date; until?: Date; maxPoints?: number },
): Promise<{ points: DataPoint[]; totalCount: number }> {
  const dataPoints = await getCollection('dataPoints');
  const filter = buildDataPointFilter(serial, options);

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
      points: docs.map(toDataPoint),
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
    return { points: sampleDataPoints(docs, max), totalCount };
  }

  // Very large histories: sample evenly across the entire range with
  // `$bucketAuto` so periods like "All Time" span the full history instead of
  // only the most recent slice. `$top` keeps the earliest reading per bucket.
  trackMongoOperation('aggregate', DATA_POINTS_COLLECTION);
  const buckets = await dataPoints
    .aggregate<{ doc: DataPointDocument }>([
      { $match: filter },
      {
        $bucketAuto: {
          groupBy: '$timestamp',
          buckets: max,
          output: { doc: { $top: { output: '$$ROOT', sortBy: { timestamp: 1 } } } },
        },
      },
    ])
    .toArray();

  const sampled = buckets
    .map((bucket) => bucket.doc)
    .filter((doc): doc is DataPointDocument => Boolean(doc))
    .map(toDataPoint);

  return { points: sortDataPoints(sampled), totalCount };
}

/** Removes every stored data point for a single device. */
export async function deleteAllDataPointsForDevice(serial: number): Promise<number> {
  const dataPoints = await getCollection('dataPoints');
  trackMongoOperation('deleteMany', DATA_POINTS_COLLECTION);
  const result = await dataPoints.deleteMany({ deviceSerial: serial });
  return result.deletedCount ?? 0;
}

/**
 * Loads data points for server-side query execution. Unlike the graph endpoint
 * this never samples points: it returns the most recent `maxPoints` documents
 * (oldest first) and reports whether the result was truncated.
 */
export async function getDataPointsForQuery(
  serial: number,
  options?: { since?: Date; until?: Date; maxPoints?: number; knownTotalCount?: number },
): Promise<{ points: DataPoint[]; totalCount: number; truncated: boolean }> {
  const dataPoints = await getCollection('dataPoints');
  const filter = buildDataPointFilter(serial, options);

  let totalCount = options?.knownTotalCount;
  if (totalCount === undefined) {
    trackMongoOperation('countDocuments', DATA_POINTS_COLLECTION);
    totalCount = await dataPoints.countDocuments(filter);
  }

  if (totalCount === 0) {
    return { points: [], totalCount: 0, truncated: false };
  }

  const max = Math.max(1, options?.maxPoints ?? 50_000);
  const projection = { _id: 0, timestamp: 1, temperature: 1, humidity: 1, airPressure: 1 };

  trackMongoOperation('find', DATA_POINTS_COLLECTION);
  const docs = totalCount <= max
    ? await dataPoints
      .find(filter, { projection })
      .sort({ timestamp: 1 })
      .toArray()
    : await dataPoints
      .find(filter, { projection })
      .sort({ timestamp: -1 })
      .limit(max)
      .toArray();

  if (totalCount > max) docs.reverse();

  return {
    points: docs.map(toDataPoint),
    totalCount,
    truncated: totalCount > max,
  };
}


/** A materialized, unsampled read for exports; never used for the graph view. */
export const MAX_DATA_POINT_EXPORT = 1_000_000;

export async function getDataPointsForExport(
  serial: number,
  options: { since: Date; until: Date; maxPoints?: number },
): Promise<{ points: DataPoint[]; totalCount: number; truncated: boolean }> {
  const dataPoints = await getCollection('dataPoints');
  const filter = buildDataPointFilter(serial, { since: options.since, until: options.until });

  trackMongoOperation('countDocuments', DATA_POINTS_COLLECTION);
  const totalCount = await dataPoints.countDocuments(filter);
  if (totalCount === 0) return { points: [], totalCount: 0, truncated: false };

  const max = Math.max(1, options.maxPoints ?? MAX_DATA_POINT_EXPORT);
  const projection = { _id: 0, timestamp: 1, temperature: 1, humidity: 1, airPressure: 1 };

  trackMongoOperation('find', DATA_POINTS_COLLECTION);
  const docs = totalCount <= max
    ? await dataPoints
      .find(filter, { projection })
      .sort({ timestamp: 1 })
      .toArray()
    : await dataPoints
      .find(filter, { projection })
      .sort({ timestamp: -1 })
      .limit(max)
      .toArray();

  if (totalCount > max) docs.reverse();

  return {
    points: docs.map(toDataPoint),
    totalCount,
    truncated: totalCount > max,
  };
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
