import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { User, UserRole } from "../../common";
import { getActiveSuspensionForUserUuid, getUserFromToken, updateUser } from "../workers/dbWriter";

export const TOKEN_EXPIRE_DURATION_SECONDS = 48 * 60 * 60; // 48 hours
export type TokenVerificationResult = "invalid" | "expired" | "success";

const PASSWORD_HASH_ALGORITHM = "scrypt";
const PASSWORD_HASH_LENGTH = 64;

export type AuthenticatedHandler = (request: Request, user: User) => Promise<Response> | Response;

export type AuthGuardOptions = {
  allowSuspended?: boolean;
};

export type AuthErrorBody = {
  error: string;
};

export function getAuthError(message: string, status = 401): Response {
  return Response.json({ error: message } satisfies AuthErrorBody, { status });
}

export function createPasswordHash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, PASSWORD_HASH_LENGTH).toString("hex");
  return `${PASSWORD_HASH_ALGORITHM}$${salt}$${derived}`;
}

export function verifyPassword(password: string, passwordHash?: string): boolean {
  if (!passwordHash) return false;

  const [algorithm, salt, derivedHash] = passwordHash.split("$");
  if (algorithm !== PASSWORD_HASH_ALGORITHM || !salt || !derivedHash) return false;

  const computed = scryptSync(password, salt, PASSWORD_HASH_LENGTH);
  const stored = Buffer.from(derivedHash, "hex");

  if (computed.length !== stored.length) return false;

  return timingSafeEqual(computed, stored);
}

export function createToken(user: User) {
  const token = randomBytes(32).toString("hex");
  user.auth.token = token;
  user.auth.issuedAt = new Date();
  return token;
}

export async function issueToken(user: User) {
  const token = createToken(user);
  await updateUser(user);
  return token;
}

export function clearToken(user: User) {
  delete user.auth.token;
  delete user.auth.issuedAt;
}

export async function createUserRecord(user: User, password: string) {
  user.auth.passwordHash = createPasswordHash(password);
  await updateUser(user);
  return user;
}

export function getExpiryDate(date: Date): Date {
  return new Date(date.getTime() + TOKEN_EXPIRE_DURATION_SECONDS * 1000);
}

export function verifyToken(user: User, token: string): TokenVerificationResult {
  if (!user.auth.issuedAt || !user.auth.token) return "invalid";

  const tokenExpiresAt = getExpiryDate(user.auth.issuedAt);
  if (Date.now() > tokenExpiresAt.getTime()) {
    return "expired";
  }

  if (user.auth.token !== token) return "invalid";

  return "success";
}

export function getBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization") ?? request.headers.get("Authentication");

  if (!authHeader?.startsWith("Bearer ")) return null;

  return authHeader.substring(7).trim();
}

export async function getUserFromRequest(request: Request): Promise<User | null> {
  const token = getBearerToken(request);

  if (!token) return null;

  const user = await getUserFromToken(token);

  if (!user) return null;

  const verificationResult = verifyToken(user, token);
  if (verificationResult !== "success") {
    return null;
  }

  user.lastActive = new Date();
  await updateUser(user);

  return user;
}

const roleRank: Record<UserRole, number> = {
  user: 0,
  staff: 1,
  owner: 2,
};

export function hasRoleAtLeast(userRole: UserRole, minimumRole: UserRole) {
  return (roleRank[userRole] || 0) >= (roleRank[minimumRole] || 0);
}

export function requireAuth(handler: AuthenticatedHandler, options: AuthGuardOptions = {}) {
  return async (request: Request) => {
    const user = await getUserFromRequest(request);

    if (!user) {
      return getAuthError("Unauthorized");
    }

    const activeSuspension = await getActiveSuspensionForUserUuid(user.uuid);
    if (activeSuspension && !options.allowSuspended) {
      return Response.json(
        {
          error: "Account suspended",
          suspension: activeSuspension,
        },
        { status: 403 },
      );
    }

    return handler(request, user);
  };
}

export function requireRole(minimumRole: UserRole, handler: AuthenticatedHandler, options: AuthGuardOptions = {}) {
  return requireAuth(async (request, user) => {
    if (!hasRoleAtLeast(user.role, minimumRole)) {
      return getAuthError("Forbidden", 403);
    }

    return handler(request, user);
  }, options);
}
