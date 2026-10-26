import type { RequestClient } from './client';

export function createOAuthApi(client: RequestClient) {
  return {
    async getPublicApp(clientId: string) {
      return client.requestJson<{ app: { clientId: string; name: string; description?: string; homepageUrl: string; logoUrl?: string; tosUrl?: string; privacyUrl?: string; allowedScopes: string[] } }>(`/api/oauth/apps/${encodeURIComponent(clientId)}`, { auth: false });
    },
    async authorize(input: { clientId: string; redirectUri: string; scope?: string; state?: string }) {
      return client.requestJson<{ code: string; redirectUri: string; state?: string }>('/api/oauth/authorize', {
        method: 'POST',
        body: { clientId: input.clientId, redirectUri: input.redirectUri, scope: input.scope, state: input.state },
      });
    },
  };
}
