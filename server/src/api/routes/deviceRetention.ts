import type { DeviceDocument } from '../../lib/db';
import {
  getDevicesForTeamId,
  getUserFromUuid,
  pruneDataPointsForSerials,
} from '../../lib/db';
import { getTeamById, getTeamForUser, getTeamSharedSeats } from '../../lib/db/teams';
import { redisFixedWindow } from '../../lib/redis';
import { createLogger } from '../../lib/logger';
import { DATA_POINT_PRUNE_COOLDOWN_MS } from './deviceRetentionConstants';
import { getPlanFeatures, type User } from '@common';

const DATA_POINT_PRUNE_KEY_PREFIX = 'ayphr:telemetry:prune:';
const localDataPointPruneByOwner = new Map<string, number>();
const log = createLogger('device-retention');

async function shouldPruneOwnerDataPoints(teamId: string): Promise<boolean> {
  const now = Date.now();
  try {
    const { count } = await redisFixedWindow(
      `${DATA_POINT_PRUNE_KEY_PREFIX}${teamId}`,
      DATA_POINT_PRUNE_COOLDOWN_MS,
    );
    return count === 1;
  } catch {
    const lastPrunedAt = localDataPointPruneByOwner.get(teamId) ?? 0;
    if (now - lastPrunedAt < DATA_POINT_PRUNE_COOLDOWN_MS) return false;

    localDataPointPruneByOwner.set(teamId, now);
    if (localDataPointPruneByOwner.size > 10_000) {
      for (const [uuid, timestamp] of localDataPointPruneByOwner) {
        if (now - timestamp >= DATA_POINT_PRUNE_COOLDOWN_MS) localDataPointPruneByOwner.delete(uuid);
      }
      while (localDataPointPruneByOwner.size > 10_000) {
        const oldestUuid = localDataPointPruneByOwner.keys().next().value;
        if (oldestUuid === undefined) break;
        localDataPointPruneByOwner.delete(oldestUuid);
      }
    }
    return true;
  }
}

export async function pruneOwnerDataPoints(
  teamId: string,
  user?: User,
  devices?: DeviceDocument[],
): Promise<boolean> {
  if (!(await shouldPruneOwnerDataPoints(teamId))) return false;

  try {
    const now = Date.now();
    let owner: User | undefined = user;
    if (!owner) {
      const team = await getTeamById(teamId);
      owner = team ? (await getUserFromUuid(team.managerUuid)) ?? undefined : (await getUserFromUuid(teamId)) ?? undefined;
    }
    const ownerDevices = devices ?? await getDevicesForTeamId(teamId);
    if (!owner) return false;

    const team = await getTeamForUser(owner);
    const manager = team ? await getUserFromUuid(team.managerUuid) : null;
    const seats = team && manager ? await getTeamSharedSeats(team, manager) : undefined;
    const features = getPlanFeatures(team?.tier ?? 'free', seats);
    const cutoff = new Date(now - features.dataRetentionDays * 86_400_000);
    const removed = await pruneDataPointsForSerials(
      ownerDevices.map((device) => device.serial),
      features.sharedMaxDataPointsPerUser,
      cutoff,
    );
    return removed > 0;
  } catch (error) {
    log.error({ error, teamId }, 'failed to prune data points');
    return false;
  }
}
