import type { UserMePayload, UserMeResponse, PublicUser } from '../../../common';
import type { AyphrRequestClient } from './client';

export function createUsersApi(client: AyphrRequestClient) {
  return {
    async me() {
      const response = await client.requestJson<UserMePayload>('/api/users/me');
      return {
        user: response.user,
        activeSuspension: response.activeSuspension || null,
      } satisfies UserMeResponse;
    },
    async getByUuid(uuid: string) {
      const response = await client.requestJson<{ user: PublicUser; requestedBy: PublicUser }>(`/api/users/${uuid}`);
      return {
        user: response.user,
        requestedBy: response.requestedBy,
      };
    },
  };
}
