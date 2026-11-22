import type { PunishmentPayload, PunishmentsMePayload } from '@common';
import type { RequestClient } from './client';
import { API_PATHS, apiPath } from './generated/routes';

export function createPunishmentsApi(client: RequestClient) {
  return {
    async me() {
      const response = await client.requestJson<PunishmentsMePayload>(apiPath(API_PATHS.getPunishmentsMe));
      return {
        user: response.user,
        activeSuspension: response.activeSuspension || null,
        punishments: response.punishments,
      } satisfies PunishmentsMePayload;
    },
    async getById(id: string) {
      const response = await client.requestJson<PunishmentPayload>(apiPath(API_PATHS.getPunishmentsId, { id: id }));
      return response.punishment;
    },
    async submitAppeal(punishmentId: string, text: string) {
      await client.requestJson(apiPath(API_PATHS.postPunishmentsIdAppeal, { id: punishmentId }), {
        method: 'POST',
        body: { text },
      });
    },
    async getAppeal(punishmentId: string) {
      const response = await client.requestJson<{ appeal: import('@common').Appeal | null }>(apiPath(API_PATHS.getPunishmentsIdAppeal, { id: punishmentId }));
      return response.appeal;
    },
  };
}
