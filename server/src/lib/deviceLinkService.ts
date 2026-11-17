import type { User } from '@common';
import {
  countDevices,
  createDevice,
  createDeviceToken,
  ensureDefaultLocation,
  getDeviceBySerial,
  getDevicePairingByCode,
  getDevicesForTeamId,
  getLocationById,
  markDevicePairingLinked,
  markDeviceTokensInactive,
  updateDeviceLocation,
  updateDeviceToken,
  type DeviceDocument,
} from './db';
import {
  getTeamForUser,
  getTeamRole,
  getTeamScopeUsername,
  getTeamScopeUuid,
} from './db/teams';
import { getPlanFeatures } from '@common';
import { setTotalDevices, devicesRegisteredTotal } from './metrics';

type LinkDeviceResult =
  | { kind: 'invalid-location' }
  | { kind: 'invalid-or-expired-code' }
  | { kind: 'code-used' }
  | { kind: 'forbidden' }
  | { kind: 'member-forbidden' }
  | { kind: 'device-limit' }
  | { kind: 'linked'; device: DeviceDocument };

export async function linkDevice(params: {
  user: User;
  code: string;
  locationId: string | null;
}): Promise<LinkDeviceResult> {
  const { user, code, locationId } = params;
  const scopeUuid = await getTeamScopeUuid(user);

  let resolvedLocationId: string | null = null;
  if (locationId) {
    const requestedLocation = await getLocationById(locationId);
    if (requestedLocation?.teamId !== scopeUuid) return { kind: 'invalid-location' };
    resolvedLocationId = requestedLocation.id;
  }

  const pairing = await getDevicePairingByCode(code);
  const now = new Date();
  if (!pairing || pairing.expiresAt.getTime() <= now.getTime()) {
    return { kind: 'invalid-or-expired-code' };
  }
  if (pairing.linked) return { kind: 'code-used' };

  const serial = pairing.serial;
  const name = pairing.name ?? `Device ${serial}`;
  const tokenHash = pairing.tokenHash;
  const existing = await getDeviceBySerial(serial);
  let device: DeviceDocument;

  if (existing) {
    if (existing.teamId !== scopeUuid) return { kind: 'forbidden' };

    await updateDeviceToken(serial, tokenHash, pairing.createdAt);
    await markDeviceTokensInactive(serial, scopeUuid);
    await createDeviceToken({
      id: crypto.randomUUID(),
      serial,
      teamId: scopeUuid,
      tokenHash,
      createdAt: pairing.createdAt,
      location: {},
      active: true,
      userAgent: undefined,
    });
    if (resolvedLocationId && existing.locationId !== resolvedLocationId) {
      await updateDeviceLocation(serial, resolvedLocationId);
      existing.locationId = resolvedLocationId;
    }
    device = { ...existing, tokenHash, tokenCreatedAt: pairing.createdAt };
  } else {
    const team = await getTeamForUser(user);
    if (team && getTeamRole(user) === 'member') return { kind: 'member-forbidden' };

    const ownedDevices = await getDevicesForTeamId(scopeUuid);
    const maxDevices = getPlanFeatures(team?.tier ?? 'free').maxDevices;
    if (ownedDevices.length >= maxDevices) return { kind: 'device-limit' };

    const scopeUsername = await getTeamScopeUsername(user);
    const location = resolvedLocationId
      ? { id: resolvedLocationId }
      : await ensureDefaultLocation(scopeUuid, scopeUsername);
    const newDevice: DeviceDocument = {
      serial,
      name,
      teamId: scopeUuid,
      ownerUsername: scopeUsername,
      locationId: location.id,
      registeredAt: now,
      tokenHash,
      tokenCreatedAt: pairing.createdAt,
    };

    await createDevice(newDevice);
    await createDeviceToken({
      id: crypto.randomUUID(),
      serial,
      teamId: scopeUuid,
      tokenHash,
      createdAt: pairing.createdAt,
      location: {},
      active: true,
    });
    device = newDevice;
    devicesRegisteredTotal.inc();
    try {
      setTotalDevices(await countDevices());
    } catch {
      // Best effort.
    }
  }

  const linked = await markDevicePairingLinked(code, user.uuid, user.username);
  if (!linked) return { kind: 'code-used' };
  return { kind: 'linked', device };
}
