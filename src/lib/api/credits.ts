import type { CreditsMePayload } from '@common';
import type { RequestClient } from './client';
import { API_PATHS, apiPath } from './generated/routes';

export function createCreditsApi(client: RequestClient) {
  return {
    async me() {
      const response = await client.requestJson<CreditsMePayload>(apiPath(API_PATHS.getCreditsMe));
      return response.credits;
    },
  };
}
