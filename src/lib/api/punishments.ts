import type { PunishmentPayload, PunishmentsMePayload } from '@common';
import type { RequestClient } from './client';

export function createPunishmentsApi(client: RequestClient) {
  return {
    async me() {
      const response = await client.requestJson<PunishmentsMePayload>('/api/punishments/me');
      return {
        user: response.user,
        activeSuspension: response.activeSuspension || null,
        punishments: response.punishments,
      } satisfies PunishmentsMePayload;
    },
    async getById(id: string) {
      const response = await client.requestJson<PunishmentPayload>(`/api/punishments/${id}`);
      return response.punishment;
    },
    async submitAppeal(punishmentId: string, text: string) {
      await client.requestJson(`/api/punishments/${encodeURIComponent(punishmentId)}/appeal`, {
        method: 'POST',
        body: { text },
      });
    },
    async getAppeal(punishmentId: string) {
      const response = await client.requestJson<{ appeal: import('@common').Appeal | null }>(`/api/punishments/${encodeURIComponent(punishmentId)}/appeal`);
      return response.appeal;
    },
  };
}
