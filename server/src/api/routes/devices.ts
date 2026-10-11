import { requireAuth } from '../auth';
import { createDevice, getDeviceBySerial, getDevicesForOwnerUuid } from '../../workers/dbWriter';
import type { Device, User } from '@common';

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

const MAX_SERIAL = 0xFFFFFFFF;

function parseSerial(value: unknown): number | null {
  let serial: number;

  if (typeof value === 'number') {
    serial = value;
  } else if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    serial = Number(value.trim());
  } else {
    return null;
  }

  if (!Number.isInteger(serial) || serial < 0 || serial > MAX_SERIAL) return null;

  return serial;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readJsonBody(request: Request): Promise<any> {
  if (!request.headers.get('content-type')?.includes('application/json')) return null;
  try {
    return await request.json();
  } catch {
    return null;
  }
}

const handleRegister = requireAuth(async (request, user: User) => {
  const body = await readJsonBody(request);
  const serial = parseSerial(body?.serial);

  if (serial === null) {
    return json({ error: 'invalid serial' }, 400);
  }

  const existing = await getDeviceBySerial(serial);
  if (existing) return json({ error: 'serial already registered' }, 409);

  const now = new Date();
  const device: Device = {
    serial,
    ownerUuid: user.uuid,
    ownerUsername: user.username,
    registeredAt: now
  };

  await createDevice(device);

  return json({ device }, 201);
});

const handleListMine = requireAuth(async (_request, user: User) => {
  const devices = await getDevicesForOwnerUuid(user.uuid);
  return json({ devices });
});

const handleGetBySerial = requireAuth(async (_request, user: User, params) => {
  const serial = parseSerial(params.serial);
  if (serial === null) return json({ error: 'invalid serial' }, 400);

  const device = await getDeviceBySerial(serial);
  if (!device) return json({ error: 'not found' }, 404);

  if (device.ownerUuid !== user.uuid) return json({ error: 'forbidden' }, 403);

  return json({ device });
});

export { handleRegister, handleListMine, handleGetBySerial };
