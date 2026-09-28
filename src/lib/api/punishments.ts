import type { PunishmentPayload, PunishmentsMePayload, PunishmentsMeResponse } from '../../../common';
import type { RequestClient } from './client';

export function createPunishmentsApi(client: RequestClient) {
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
