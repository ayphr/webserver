import { requireAuth } from '../auth';
import { createDevice, getDeviceBySerial, getDevicesForOwnerUuid } from '../../workers/dbWriter';
import type { Device, User } from '../../../../common';
import { handleApiNotFoundRoute } from './util';

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
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
  const serial = typeof body?.serial === 'number' ? body.serial : typeof body?.serial === 'string' ? Number(body.serial) : NaN;

  if (!Number.isFinite(serial) || serial < 0 || serial > 0xFFFFFFFF) {
    return json({ error: 'invalid serial' }, 400);
  }

  const existing = await getDeviceBySerial(serial);
  if (existing) return json({ error: 'serial already registered' }, 409);

  // location: { lat, lon }
  let location: Device['location'] | null = null;
  if (body?.location && typeof body.location === 'object') {
    const lat = Number(body.location.lat);
    const lon = Number(body.location.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      location = { type: 'Point', coordinates: [lon, lat] };
    } else {
      return json({ error: 'invalid location' }, 400);
    }
  }

  if (location == null) return json({ error: 'invalid location' }, 400);

  const now = new Date();
  const device: Device = {
    serial,
    ownerUuid: user.uuid,
    ownerUsername: user.username,
    registeredAt: now,
    location
  };

  await createDevice(device);

  return json({ device }, 201);
});

const handleListMine = requireAuth(async (_request, user: User) => {
  const devices = await getDevicesForOwnerUuid(user.uuid);
  return json({ devices });
});

const handleGetBySerial = requireAuth(async (request, user: User) => {
  const parts = new URL(request.url).pathname.split('/');
  const serialStr = parts[parts.length - 1];
  const serial = Number(serialStr);
  if (!Number.isFinite(serial)) return json({ error: 'invalid serial' }, 400);

  const device = await getDeviceBySerial(serial);
  if (!device) return json({ error: 'not found' }, 404);

  if (device.ownerUuid !== user.uuid) return json({ error: 'forbidden' }, 403);

  return json({ device });
});

export function handleDevicesRoute(request: Request) {
  const url = new URL(request.url);

  if (request.method === 'POST' && (url.pathname === '/api/devices' || url.pathname === '/api/devices/register')) {
    return handleRegister(request);
  }

  if (request.method === 'GET' && (url.pathname === '/api/devices' || url.pathname === '/api/devices/mine')) {
    return handleListMine(request);
  }

  if (request.method === 'GET' && url.pathname.startsWith('/api/devices/') && url.pathname !== '/api/devices/mine' && url.pathname !== '/api/devices/register') {
    return handleGetBySerial(request);
  }

  return handleApiNotFoundRoute(request);
}
