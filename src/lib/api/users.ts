import type { UserMePayload, PublicUser } from '@common';
import type { RequestClient } from './client';

export function createUsersApi(client: RequestClient) {
  // Deduplicate concurrent/shortly-repeated `/api/users/me` requests. The
  // PolicyGate and the page it wraps both need this data, so sharing one
  // in-flight (and recently resolved) promise avoids a duplicate round trip
  // and makes the dashboard and other gated pages load faster.
  const ME_CACHE_TTL_MS = 10_000;
  let cachedMe:
    | { token: string | null; at: number; promise: Promise<UserMePayload> }
    | null = null;

  const invalidateMe = () => {
    cachedMe = null;
  };

  return {
    async me() {
      const token = client.getAuthToken();
      const now = Date.now();
      if (cachedMe && cachedMe.token === token && now - cachedMe.at < ME_CACHE_TTL_MS) {
        return cachedMe.promise;
      }

      const promise = client
        .requestJson<UserMePayload>('/api/users/me')
        .then((response) => ({
          user: response.user,
          activeSuspension: response.activeSuspension || null,
          policyStatus: response.policyStatus ?? null,
        } satisfies UserMePayload));

      cachedMe = { token, at: now, promise };
      promise.catch(() => {
        if (cachedMe?.promise === promise) cachedMe = null;
      });

      return promise;
    },
    invalidateMe,
    async getByUuid(uuid: string) {
      const response = await client.requestJson<{ user: PublicUser; requestedBy: PublicUser }>(`/api/users/${uuid}`);
      return {
        user: response.user,
        requestedBy: response.requestedBy,
      };
    },
    async setDeveloperAccount(enabled: boolean) {
      const response = await client.requestJson<{ user: PublicUser }>('/api/users/me/developer', {
        method: 'PATCH',
        body: { enabled },
      });
      invalidateMe();
      return response.user;
    },
  };
}
