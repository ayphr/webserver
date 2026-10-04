import { createHash } from 'node:crypto';
import { clearToken, createPasswordHash, issueToken, requireAuth, verifyPassword } from '../auth';
import { createUser, getActiveSuspensionForUserUuid, getUserFromUsername, updateUser } from '../../workers/dbWriter';
import type { User } from '@common';
import { normalizeCountryCode } from '../../lib/country';
import { DEFAULT_BIO } from '@common/utils/bio';
import { getPasswordValidationErrors } from '@common/utils/password';

type AuthPayload = {
  username?: string;
  password?: string;
  country?: string;
};

const PWNED_PASSWORDS_RANGE_ENDPOINT = 'https://api.pwnedpasswords.com/range/';

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function publicUser(user: User) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { auth, ...rest } = user;
  return rest;
}

async function readJsonBody(request: Request): Promise<AuthPayload | null> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return null;
  }

  try {
    return await request.json() as AuthPayload;
  } catch {
    return null;
  }
}

async function isKnownBreachedPassword(password: string): Promise<boolean> {
  const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  try {
    const response = await fetch(`${PWNED_PASSWORDS_RANGE_ENDPOINT}${prefix}`, {
      headers: {
        'Add-Padding': 'true',
      },
    });

    if (!response.ok) {
      return false;
    }

    const hashList = await response.text();
    const matchedHashLine = hashList
      .split('\r\n')
      .find((line) => line.split(':', 1)[0] === suffix);

    return Boolean(matchedHashLine);
  } catch {
    return false;
  }
}

async function handleRegister(request: Request) {
  const body = await readJsonBody(request);

  if (!body?.username || !body.password) {
    return json({ error: 'username and password are required' }, 400);
  }

  const passwordValidationErrors = getPasswordValidationErrors(body.password);
  if (passwordValidationErrors.length > 0) {
    return json({ error: passwordValidationErrors[0] }, 400);
  }

  const isBreachedPassword = await isKnownBreachedPassword(body.password);
  if (isBreachedPassword) {
    return json({ error: 'password has appeared in known data breaches, please choose a different password' }, 400);
  }

  const existingUser = await getUserFromUsername(body.username);
  if (existingUser) {
    return json({ error: 'username already exists' }, 409);
  }

  let country: string | undefined;
  if (typeof body.country === 'string') {
    const countryCode = normalizeCountryCode(body.country);
    if (!countryCode) {
      return json({ error: 'country must be a valid ISO 3166-1 alpha-2 code' }, 400);
    }
    country = countryCode;
  }

  const now = new Date();
  const user: User = {
    uuid: crypto.randomUUID(),
    username: body.username,
    role: 'user',
    bio: DEFAULT_BIO,
    socialLinks: {},
    auth: {
      passwordHash: createPasswordHash(body.password),
    },
    createdAt: now,
    lastActive: now,
    country,
  };

  await createUser(user);

  const token = await issueToken(user);

  return json({ user: publicUser(user), token }, 201);
}

async function handleLogin(request: Request) {
  const body = await readJsonBody(request);

  if (!body?.username || !body.password) {
    return json({ error: 'username and password are required' }, 400);
  }

  const user = await getUserFromUsername(body.username);
  if (!user || !verifyPassword(body.password, user.auth.passwordHash)) {
    return json({ error: 'invalid username or password' }, 401);
  }

  const activeSuspension = await getActiveSuspensionForUserUuid(user.uuid);
  if (activeSuspension) {
    return Response.json(
      {
        error: 'Account suspended',
        suspension: activeSuspension,
      },
      { status: 403 },
    );
  }

  user.lastActive = new Date();
  const token = await issueToken(user);

  return json({ user: publicUser(user), token });
}

const handleMe = requireAuth(async (_request, user) => {
  const activeSuspension = await getActiveSuspensionForUserUuid(user.uuid);

  return json({
    user: publicUser(user),
    suspension: activeSuspension,
  });
}, { allowSuspended: true });

const handleLogout = requireAuth(async (_request, user) => {
  clearToken(user);
  await updateUser(user);
  return new Response(null, { status: 204 });
}, { allowSuspended: true });

export { handleRegister, handleLogin, handleMe, handleLogout };
