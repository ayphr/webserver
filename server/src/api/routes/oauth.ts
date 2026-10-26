import { requireAuth } from '../auth';
import {
  getAppByClientId,
  getAppById,
  getOAuthCodeByHash,
  createOAuthCode,
  markOAuthCodeUsed,
  createOAuthToken,
  getOAuthTokenByHash,
  getConnectionByUserAndApp,
  createConnection,
  updateConnectionScopes,
  getConnectionsForUser,
  revokeConnection,
  getUserFromUuid,
  getDevicesForOwnerUuid,
} from '../../lib/db';
import { hashToken } from '../../lib/tokens';
import { toPublicUser } from '../../lib/user';
import { toPublicDevice } from '../../lib/db';
import type { AppScope } from '@common';
import type { RouteParams } from '../types';

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function readBody(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get('content-type')?.includes('application/json')) return Promise.resolve(null);
  return request.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

async function getOAuthAuth(request: Request) {
  const authHeader = request.headers.get('Authorization') ?? request.headers.get('Authentication');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7).trim();
  const tokenHash = hashToken(token);
  const stored = await getOAuthTokenByHash(tokenHash);
  if (!stored) return null;
  if (stored.revokedAt) return null;
  if (Date.now() > new Date(stored.expiresAt).getTime()) return null;
  const user = await getUserFromUuid(stored.userId);
  if (!user) return null;
  const app = await getAppById(stored.appId);
  if (!app) return null;
  return { user, token: stored, scopes: stored.scopes, app };
}

// Public app info for consent screen
const handlePublicApp = async (_request: Request, params: RouteParams) => {
  const app = await getAppByClientId(params.clientId!);
  if (!app) return json({ error: 'not found' }, 404);
  return json({
    app: {
      clientId: app.clientId,
      name: app.name,
      description: app.description,
      homepageUrl: app.homepageUrl,
      logoUrl: app.logoUrl,
      tosUrl: app.tosUrl,
      privacyUrl: app.privacyUrl,
      allowedScopes: app.allowedScopes,
    },
  });
};

// Authorize (user session required)
const handleAuthorize = requireAuth(async (request, user) => {
  const body = await readBody(request);
  if (!body) return json({ error: 'invalid body' }, 400);

  const clientId = typeof body.clientId === 'string' ? body.clientId : '';
  const redirectUri = typeof body.redirectUri === 'string' ? body.redirectUri : '';
  const scopeStr = typeof body.scope === 'string' ? body.scope : (typeof body.scopes === 'string' ? body.scopes : '');
  const state = typeof body.state === 'string' ? body.state : undefined;

  const app = await getAppByClientId(clientId);
  if (!app) return json({ error: 'invalid client' }, 400);
  if (!app.redirectUris.includes(redirectUri)) return json({ error: 'invalid redirect_uri' }, 400);

  const requestedScopes = scopeStr.split(/[ ,]+/).filter(Boolean);
  const scopes: AppScope[] = requestedScopes.length ? requestedScopes : ['identify'];
  for (const s of scopes) {
    if (!app.allowedScopes.includes(s)) return json({ error: `scope not allowed: ${s}` }, 400);
  }

  const code = crypto.randomUUID() + crypto.randomUUID();
  const codeHash = hashToken(code);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);

  await createOAuthCode({
    codeHash,
    appId: app.id,
    clientId: app.clientId,
    userId: user.uuid,
    redirectUri,
    scopes,
    expiresAt,
    used: false,
    createdAt: now,
  });

  return json({ code, redirectUri, state });
});

// Token exchange
const handleToken = async (request: Request) => {
  const body = await readBody(request);
  if (!body) return json({ error: 'invalid body' }, 400);

  const grantType = typeof body.grantType === 'string' ? body.grantType : (typeof body.grant_type === 'string' ? body.grant_type : '');
  const clientId = typeof body.clientId === 'string' ? body.clientId : (typeof body.client_id === 'string' ? body.client_id : '');
  const clientSecret = typeof body.clientSecret === 'string' ? body.clientSecret : (typeof body.client_secret === 'string' ? body.client_secret : '');

  const app = await getAppByClientId(clientId);
  if (!app) return json({ error: 'invalid client' }, 400);
  if (hashToken(clientSecret) !== app.clientSecretHash) return json({ error: 'invalid client secret' }, 401);

  if (grantType === 'authorization_code') {
    const code = typeof body.code === 'string' ? body.code : '';
    const redirectUri = typeof body.redirectUri === 'string' ? body.redirectUri : (typeof body.redirect_uri === 'string' ? body.redirect_uri : '');
    const codeHash = hashToken(code);
    const storedCode = await getOAuthCodeByHash(codeHash);
    if (!storedCode || storedCode.used) return json({ error: 'invalid code' }, 400);
    if (storedCode.clientId !== clientId) return json({ error: 'invalid code' }, 400);
    if (storedCode.redirectUri !== redirectUri) return json({ error: 'invalid redirect_uri' }, 400);
    if (Date.now() > new Date(storedCode.expiresAt).getTime()) return json({ error: 'code expired' }, 400);

    await markOAuthCodeUsed(codeHash);

    // Ensure connection
    let connection = await getConnectionByUserAndApp(storedCode.userId, app.id);
    if (!connection) {
      const now = new Date();
      connection = await createConnection({
        id: crypto.randomUUID(),
        userId: storedCode.userId,
        appId: app.id,
        clientId: app.clientId,
        appName: app.name,
        appLogoUrl: app.logoUrl,
        appHomepageUrl: app.homepageUrl,
        scopes: storedCode.scopes,
        createdAt: now,
      });
    } else {
      const union = Array.from(new Set([...connection.scopes, ...storedCode.scopes]));
      await updateConnectionScopes(connection.id, union);
      connection = { ...connection, scopes: union };
    }

    const accessToken = crypto.randomUUID() + crypto.randomUUID();
    const accessTokenHash = hashToken(accessToken);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    await createOAuthToken({
      tokenHash: accessTokenHash,
      appId: app.id,
      clientId: app.clientId,
      userId: storedCode.userId,
      scopes: storedCode.scopes,
      connectionId: connection.id,
      expiresAt,
      createdAt: now,
    });

    const response: import('@common').OAuthTokenResponse = {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: 7 * 24 * 60 * 60,
      scope: storedCode.scopes.join(' '),
    };
    return json(response);
  }

  return json({ error: 'unsupported grant_type' }, 400);
};

// Userinfo (OAuth token)
const handleUserinfo = async (request: Request) => {
  const auth = await getOAuthAuth(request);
  if (!auth) return json({ error: 'Unauthorized' }, 401);
  if (!auth.scopes.includes('identify') && !auth.scopes.includes('profile.read')) {
    return json({ error: 'insufficient scope' }, 403);
  }
  return json({ user: toPublicUser(auth.user) });
};

// Devices list (OAuth token)
const handleOAuthDevices = async (request: Request) => {
  const auth = await getOAuthAuth(request);
  if (!auth) return json({ error: 'Unauthorized' }, 401);
  if (!auth.scopes.includes('devices.read') && !auth.scopes.includes('devices.control')) {
    return json({ error: 'insufficient scope' }, 403);
  }
  const devices = await getDevicesForOwnerUuid(auth.user.uuid);
  return json({ devices: devices.map(toPublicDevice) });
};

// Connections list (user session)
const handleConnectionsList = requireAuth(async (_request, user) => {
  const connections = await getConnectionsForUser(user.uuid);
  return json({ connections });
});

// Revoke connection (user session)
const handleRevokeConnection = requireAuth(async (_request, user, params) => {
  const ok = await revokeConnection(params.id!, user.uuid);
  if (!ok) return json({ error: 'not found' }, 404);
  return new Response(null, { status: 204 });
});

// Revoke oauth token (app? optional) not needed

export {
  handlePublicApp,
  handleAuthorize,
  handleToken,
  handleUserinfo,
  handleOAuthDevices,
  handleConnectionsList,
  handleRevokeConnection,
};
