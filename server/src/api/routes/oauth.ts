import { json } from '../../lib/http';
import { requireAuth } from '../auth';
import { getClientIp } from '../../lib/requestContext';
import { createRateLimiter, tooManyRequests } from '../../lib/rateLimit';
import {
  getAppByClientId,
  getAppById,
  getOAuthCodeByHash,
  createOAuthCode,
  markOAuthCodeUsed,
  createOAuthToken,
  getOAuthTokenByHash,
  revokeOAuthToken,
  getConnectionByUserAndApp,
  createConnection,
  updateConnectionScopes,
  recordConnectionActivity,
  getConnectionsForUser,
  revokeConnection,
  getUserFromUuid,
  getDevicesForOwnerUuid,
} from '../../lib/db';
import { createHash } from 'node:crypto';
import { hashToken } from '../../lib/tokens';
import { toPublicUser } from '../../lib/user';
import { toPublicDevice } from '../../lib/db';
import type { AppScope } from '@common';
import type { RouteParams } from '../types';

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function computeCodeChallenge(verifier: string, method: 'plain' | 'S256'): string {
  if (method === 'plain') return verifier;
  return base64UrlEncode(createHash('sha256').update(verifier).digest());
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

  // Best-effort activity tracking; never fail the request on a tracking error.
  try {
    await recordConnectionActivity(stored.connectionId, request.method, new URL(request.url).pathname, stored.scopes);
  } catch {
    // ignore
  }

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

  const codeChallenge = typeof body.codeChallenge === 'string'
    ? body.codeChallenge
    : (typeof body.code_challenge === 'string' ? body.code_challenge : undefined);
  const codeChallengeMethodRaw = typeof body.codeChallengeMethod === 'string'
    ? body.codeChallengeMethod
    : (typeof body.code_challenge_method === 'string' ? body.code_challenge_method : 'S256');

  let codeChallengeMethod: 'plain' | 'S256' | undefined;
  if (codeChallenge) {
    if (codeChallengeMethodRaw !== 'plain' && codeChallengeMethodRaw !== 'S256') {
      return json({ error: 'invalid code_challenge_method' }, 400);
    }
    codeChallengeMethod = codeChallengeMethodRaw;
  }

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
    ...(codeChallenge ? { codeChallenge, codeChallengeMethod } : {}),
  });

  return json({ code, redirectUri, state });
});

const oauthTokenLimiter = createRateLimiter(15 * 60 * 1000, 30, 'oauth-token');

// Token exchange
const handleToken = async (request: Request) => {
  const ipCheck = await oauthTokenLimiter.check(`ip:${getClientIp(request)}`);
  if (!ipCheck.allowed) return tooManyRequests(ipCheck.retryAfterMs);

  const body = await readBody(request);
  if (!body) return json({ error: 'invalid body' }, 400);

  const grantType = typeof body.grantType === 'string' ? body.grantType : (typeof body.grant_type === 'string' ? body.grant_type : '');
  const clientId = typeof body.clientId === 'string' ? body.clientId : (typeof body.client_id === 'string' ? body.client_id : '');
  const clientSecret = typeof body.clientSecret === 'string' ? body.clientSecret : (typeof body.client_secret === 'string' ? body.client_secret : '');
  const codeVerifier = typeof body.codeVerifier === 'string' ? body.codeVerifier : (typeof body.code_verifier === 'string' ? body.code_verifier : '');

  const app = await getAppByClientId(clientId);
  if (!app) return json({ error: 'invalid client' }, 400);

  // Confidential clients authenticate with their secret; public (PKCE) clients
  // may omit it, but only when a code challenge was recorded for the code.
  if (clientSecret) {
    if (hashToken(clientSecret) !== app.clientSecretHash) return json({ error: 'invalid client secret' }, 401);
  }

  if (grantType === 'authorization_code') {
    const code = typeof body.code === 'string' ? body.code : '';
    const redirectUri = typeof body.redirectUri === 'string' ? body.redirectUri : (typeof body.redirect_uri === 'string' ? body.redirect_uri : '');
    const codeHash = hashToken(code);
    const storedCode = await getOAuthCodeByHash(codeHash);
    if (!storedCode || storedCode.used) return json({ error: 'invalid code' }, 400);
    if (storedCode.clientId !== clientId) return json({ error: 'invalid code' }, 400);
    if (storedCode.redirectUri !== redirectUri) return json({ error: 'invalid redirect_uri' }, 400);
    if (Date.now() > new Date(storedCode.expiresAt).getTime()) return json({ error: 'code expired' }, 400);

    if (storedCode.codeChallenge) {
      if (!codeVerifier) return json({ error: 'code_verifier required' }, 400);
      const computed = computeCodeChallenge(codeVerifier, storedCode.codeChallengeMethod ?? 'S256');
      if (computed !== storedCode.codeChallenge) return json({ error: 'invalid code_verifier' }, 400);
    } else if (!clientSecret) {
      return json({ error: 'client secret required' }, 401);
    }

    const marked = await markOAuthCodeUsed(codeHash);
    if (!marked) return json({ error: 'invalid code' }, 400);

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

// Token revocation (RFC 7009)
const handleRevokeToken = async (request: Request) => {
  const body = await readBody(request);
  let token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!token) {
    const authHeader = request.headers.get('Authorization') ?? request.headers.get('Authentication');
    if (authHeader?.startsWith('Bearer ')) token = authHeader.slice(7).trim();
  }

  if (token) {
    const tokenHash = hashToken(token);
    const stored = await getOAuthTokenByHash(tokenHash);
    if (stored && !stored.revokedAt) {
      await revokeOAuthToken(tokenHash);
    }
  }

  // RFC 7009: always return 200 for valid requests.
  return json({});
};

// Revoke oauth token (app? optional) not needed

export {
  handlePublicApp,
  handleAuthorize,
  handleToken,
  handleUserinfo,
  handleOAuthDevices,
  handleConnectionsList,
  handleRevokeConnection,
  handleRevokeToken,
};
