import type {
  BillingInterval,
  SubscriptionAutoRenewPayload,
  SubscriptionCheckoutPayload,
  SubscriptionCheckoutRequest,
  SubscriptionMePayload,
  SubscriptionPortalPayload,
  SubscriptionTier,
} from '../../../common';
import type { RequestClient } from './client';

export function createSubscriptionsApi(client: RequestClient) {
  return {
    async me() {
      return client.requestJson<SubscriptionMePayload>('/api/subscriptions/me');
    },
    async checkout(tier: SubscriptionTier, interval: BillingInterval) {
      const response = await client.requestJson<SubscriptionCheckoutPayload>('/api/subscriptions/checkout', {
        method: 'POST',
        body: { tier, interval } satisfies SubscriptionCheckoutRequest,
      });
      return response.url;
    },
    async setAutoRenew(autoRenew: boolean) {
      const response = await client.requestJson<SubscriptionAutoRenewPayload>('/api/subscriptions/auto-renew', {
        method: 'POST',
        body: { autoRenew },
      });
      return response.paidSubscription;
    },
    async portal() {
      const response = await client.requestJson<SubscriptionPortalPayload>('/api/subscriptions/portal', {
        method: 'POST',
      });
      return response.url;
    },
    async cancelGranted(subscriptionId: string) {
      await client.requestJson(`/api/subscriptions/attached/${encodeURIComponent(subscriptionId)}`, {
        method: 'DELETE',
      });
    },
  };
}
