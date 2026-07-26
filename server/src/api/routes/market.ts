import { requireAuth } from '../auth';
import { getTelemetryByLocationAndTime, performPurchaseTransaction, getDeviceBySerial } from '../../workers/dbWriter';
import type { User } from '../../../../common';
import { OWNER_SHARE, PRICE_PER_RECORD } from '../../constants';

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

// POST /api/market/purchase
// body: { center: { lat, lon }, radiusMeters, start, end, limit }
const handlePurchase = requireAuth(async (request: Request, user: User) => {
  const body = await readJsonBody(request);
  if (!body) return json({ error: 'invalid json' }, 400);

  const center = body.center;
  const radiusMeters = Number(body.radiusMeters ?? 1000);
  const start = body.start ? new Date(body.start) : undefined;
  const end = body.end ? new Date(body.end) : undefined;
  const limit = Math.min(500, Number(body.limit ?? 100));

  if (!center || typeof center.lat !== 'number' || typeof center.lon !== 'number') return json({ error: 'invalid center' }, 400);

  const { total, records } = await getTelemetryByLocationAndTime({ lat: center.lat, lon: center.lon }, radiusMeters, start, end, limit, 0);

  const cost = (records.length || 0) * PRICE_PER_RECORD;

  const ownerAwards: Record<string, number> = {};
  const deviceOwnerCache: Record<number, string | null> = {};

  for (const rec of records) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deviceId = (rec as any).deviceId as number;
    if (deviceOwnerCache[deviceId] === undefined) {
      const dev = await getDeviceBySerial(deviceId);
      deviceOwnerCache[deviceId] = dev ? dev.ownerUuid : null;
    }
    const owner = deviceOwnerCache[deviceId];
    if (owner) {
      ownerAwards[owner] = (ownerAwards[owner] || 0) + (PRICE_PER_RECORD * OWNER_SHARE);
    }
  }

  const ok = await performPurchaseTransaction(user.uuid, cost, ownerAwards);
  if (!ok) return json({ error: 'insufficient credits or transaction failed', required: cost }, 402);

  return json({ total: total, returned: records.length, records });
});

export function handleMarketRoute(request: Request) {
  const url = new URL(request.url);

  if (request.method === 'POST' && url.pathname === '/api/market/purchase') {
    return handlePurchase(request);
  }

  return Response.json({ error: 'not found' }, { status: 404 });
}
