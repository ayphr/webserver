import type { PunishmentPayload, PunishmentsMePayload, PunishmentsMeResponse } from '../../../common';
import type { AyphrRequestClient } from './client';

export function createPunishmentsApi(client: AyphrRequestClient) {
  return {
    async me() {
      const response = await client.requestJson<PunishmentsMePayload>('/api/punishments/me');
      return {
        user: response.user,
        activeSuspension: response.activeSuspension || null,
        punishments: response.punishments,
      } satisfies PunishmentsMeResponse;
    },
    async getById(id: string) {
      const response = await client.requestJson<PunishmentPayload>(`/api/punishments/${id}`);
      return response.punishment;
    },
  };
}
