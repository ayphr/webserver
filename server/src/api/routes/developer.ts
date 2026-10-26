import { requireAuth } from '../auth';
import {
  createApp,
  getAppById,
  getAppByClientId,
  getAppsByOwner,
  updateApp,
  deleteApp,
} from '../../lib/db';
import { hashToken } from '../../lib/tokens';
import type { App, CreateAppRequest, UpdateAppRequest, AppSummary, CreateAppResponse } from '@common';
import type { RouteParams } from '../types';

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function toSummary(app: App): AppSummary {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { clientSecretHash, ...rest } = app;
  return rest as AppSummary;
}

function readBody(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get('content-type')?.includes('application/json')) return Promise.resolve(null);
  return request.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

const KNOWN_SCOPES = [
  'identify',
  'profile.read',
  'profile.write',
  'devices.read',
  'devices.control',
  'connections.read',
];

function validateScopes(scopes: unknown): string[] | null {
  if (!Array.isArray(scopes)) return [];
  const out: string[] = [];
  for (const s of scopes) {
    if (typeof s !== 'string') return null;
    if (!KNOWN_SCOPES.includes(s)) return null;
    out.push(s);
  }
  return out;
}

const handleListApps = requireAuth(async (_request, user) => {
  if (!user.developerAccount) {
    return json({ error: 'Developer account required' }, 403);
  }
  const apps = await getAppsByOwner(user.uuid);
  return json({ apps: apps.map(toSummary) });
});

const handleCreateApp = requireAuth(async (request, user) => {
  if (!user.developerAccount) {
    return json({ error: 'Developer account required' }, 403);
  }
  const body = await readBody(request);
  if (!body) return json({ error: 'invalid body' }, 400);

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const homepageUrl = typeof body.homepageUrl === 'string' ? body.homepageUrl.trim() : '';
  if (!name) return json({ error: 'name is required' }, 400);
  if (!homepageUrl) return json({ error: 'homepageUrl is required' }, 400);

  const redirectUris = Array.isArray(body.redirectUris)
    ? body.redirectUris.filter((u): u is string => typeof u === 'string')
    : [];
  const allowedScopes = validateScopes(body.allowedScopes);
  if (allowedScopes === null) return json({ error: 'invalid scopes' }, 400);

  const clientId = crypto.randomUUID();
  const clientSecret = crypto.randomUUID() + crypto.randomUUID();
  const clientSecretHash = hashToken(clientSecret);

  const now = new Date();
  const app: App = {
    id: crypto.randomUUID(),
    clientId,
    ownerId: user.uuid,
    name,
    description: typeof body.description === 'string' ? body.description : undefined,
    homepageUrl,
    logoUrl: typeof body.logoUrl === 'string' ? body.logoUrl : undefined,
    tosUrl: typeof body.tosUrl === 'string' ? body.tosUrl : undefined,
    privacyUrl: typeof body.privacyUrl === 'string' ? body.privacyUrl : undefined,
    redirectUris,
    allowedScopes: allowedScopes.length ? allowedScopes : ['identify'],
    clientSecretHash,
    createdAt: now,
    updatedAt: now,
  };

  await createApp(app);

  const response: CreateAppResponse = {
    app: toSummary(app),
    clientId,
    clientSecret,
  };
  return json(response, 201);
});

const handleGetApp = requireAuth(async (_request, user, params) => {
  const app = await getAppById(params.id!);
  if (!app || app.ownerId !== user.uuid) return json({ error: 'not found' }, 404);
  return json({ app: toSummary(app) });
});

const handleUpdateApp = requireAuth(async (request, user, params) => {
  const app = await getAppById(params.id!);
  if (!app || app.ownerId !== user.uuid) return json({ error: 'not found' }, 404);

  const body = await readBody(request);
  if (!body) return json({ error: 'invalid body' }, 400);

  const updates: Partial<App> = { updatedAt: new Date() };
  if (typeof body.name === 'string') updates.name = body.name.trim();
  if (typeof body.description === 'string') updates.description = body.description;
  if (typeof body.homepageUrl === 'string') updates.homepageUrl = body.homepageUrl.trim();
  if (typeof body.logoUrl === 'string') updates.logoUrl = body.logoUrl;
  if (typeof body.tosUrl === 'string') updates.tosUrl = body.tosUrl;
  if (typeof body.privacyUrl === 'string') updates.privacyUrl = body.privacyUrl;
  if (Array.isArray(body.redirectUris)) updates.redirectUris = body.redirectUris.filter((u): u is string => typeof u === 'string');
  if (body.allowedScopes !== undefined) {
    const scopes = validateScopes(body.allowedScopes);
    if (scopes === null) return json({ error: 'invalid scopes' }, 400);
    updates.allowedScopes = scopes;
  }

  const updated = await updateApp(params.id!, updates);
  if (!updated) return json({ error: 'not found' }, 404);
  return json({ app: toSummary(updated) });
});

const handleDeleteApp = requireAuth(async (_request, user, params) => {
  const app = await getAppById(params.id!);
  if (!app || app.ownerId !== user.uuid) return json({ error: 'not found' }, 404);
  await deleteApp(params.id!);
  return new Response(null, { status: 204 });
});

const handleRegenerateSecret = requireAuth(async (_request, user, params) => {
  const app = await getAppById(params.id!);
  if (!app || app.ownerId !== user.uuid) return json({ error: 'not found' }, 404);

  const clientSecret = crypto.randomUUID() + crypto.randomUUID();
  const clientSecretHash = hashToken(clientSecret);
  await updateApp(params.id!, { clientSecretHash, updatedAt: new Date() });
  return json({ clientId: app.clientId, clientSecret });
});

export {
  handleListApps,
  handleCreateApp,
  handleGetApp,
  handleUpdateApp,
  handleDeleteApp,
  handleRegenerateSecret,
};
