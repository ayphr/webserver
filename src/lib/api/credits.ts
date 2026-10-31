import type { CreditsMePayload } from '@common';
import type { RequestClient } from './client';

export function createCreditsApi(client: RequestClient) {
  return {
    async me() {
      const response = await client.requestJson<CreditsMePayload>('/api/credits/me');
      return response.credits;
    },
  };
}
