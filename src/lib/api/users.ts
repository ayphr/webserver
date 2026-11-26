import type { UserMePayload, PublicUser, SelfUser } from '@common';
import type { RequestClient } from './client';
import { API_PATHS, apiPath } from './generated/routes';

type MeInvalidator = () => void | Promise<void>;
let externalMeInvalidator: MeInvalidator | null = null;

export function setUsersMeInvalidator(fn: MeInvalidator | null) {
  externalMeInvalidator = fn;
}

export function createUsersApi(client: RequestClient) {
  // Deduplicate concurrent/shortly-repeated current-user requests. The
  // PolicyGate and the page it wraps both need this data, so sharing one
  // in-flight (and recently resolved) promise avoids a duplicate round trip
  // and makes the dashboard and other gated pages load faster.
  const ME_CACHE_TTL_MS = 10_000;
  let cachedMe:
    | { token: string | null; at: number; promise: Promise<UserMePayload> }
    | null = null;

  const invalidateMe = () => {
    cachedMe = null;
    void externalMeInvalidator?.();
  };

  return {
    async me() {
      const token = client.getAuthToken();
      const now = Date.now();
      if (cachedMe && cachedMe.token === token && now - cachedMe.at < ME_CACHE_TTL_MS) {
        return cachedMe.promise;
      }

      const promise = client
        .requestJson<UserMePayload>(apiPath(API_PATHS.getUsersMe))
        .then((response) => ({
          user: response.user,
          activeSuspension: response.activeSuspension || null,
          policyStatus: response.policyStatus ?? null,
          credits: response.credits,
        } satisfies UserMePayload));

      cachedMe = { token, at: now, promise };
      promise.catch(() => {
        if (cachedMe?.promise === promise) cachedMe = null;
      });

      return promise;
    },
    invalidateMe,
    async getByUuid(uuid: string) {
      const response = await client.requestJson<{ user: PublicUser; requestedBy: PublicUser }>(apiPath(API_PATHS.getUsersUuid, { uuid: uuid }));
      return {
        user: response.user,
        requestedBy: response.requestedBy,
      };
    },
    async changeUsername(username: string, currentPassword: string) {
      const response = await client.requestJson<{ user: SelfUser }>(apiPath(API_PATHS.patchUsersMeUsername), {
        method: 'PATCH',
        body: { username, currentPassword },
      });
      invalidateMe();
      return response.user;
    },
  };
}
