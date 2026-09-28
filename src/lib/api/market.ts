import type { MarketPurchaseResponse, PurchaseRequest } from '../../../common';
import type { RequestClient } from './client';

export function createMarketApi(client: RequestClient) {
  return {
    async purchase(input: PurchaseRequest) {
      return client.requestJson<MarketPurchaseResponse>('/api/market/purchase', {
        method: 'POST',
        body: {
          ...input,
          start: input.start,
          end: input.end,
        },
      });
    },
  };
}
