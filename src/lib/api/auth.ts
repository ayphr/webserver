import type { AcceptPoliciesPayload, AuthMePayload, AuthMeResponse, AuthResponsePayload, AuthSession } from '../../../common';
import type { RequestClient } from './client';

function getClientSessionMeta() {
  if (typeof navigator === 'undefined') return {};

  let timezone: string | undefined;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    timezone = undefined;
  }

  return { timezone, locale: navigator.language };
}

export function createAuthApi(client: RequestClient) {
  return {
    async register(input: { username: string; password: string; country?: string; acceptPolicies: boolean }) {
      const response = await client.requestJson<AuthResponsePayload>('/api/auth/register', {
        method: 'POST',
        auth: false,
        body: { ...input, ...getClientSessionMeta() },
      });

      client.setAuthToken(response.token);

      return {
        user: response.user,
        token: response.token,
        ...(response.suspension ? { suspension: response.suspension } : {}),
        policyStatus: response.policyStatus,
      } satisfies AuthSession;
    },
    async login(input: { username: string; password: string }) {
      const response = await client.requestJson<AuthResponsePayload>('/api/auth/login', {
        method: 'POST',
        auth: false,
        body: { ...input, ...getClientSessionMeta() },
      });

      client.setAuthToken(response.token);

      return {
        user: response.user,
        token: response.token,
        ...(response.suspension ? { suspension: response.suspension } : {}),
        policyStatus: response.policyStatus,
      } satisfies AuthSession;
    },
    async me() {
      const response = await client.requestJson<AuthMePayload>('/api/auth/me');
      return {
        user: response.user,
        suspension: response.suspension || null,
        policyStatus: response.policyStatus ?? null,
      } satisfies AuthMeResponse;
    },
    async acceptPolicies() {
      const response = await client.requestJson<AcceptPoliciesPayload>('/api/auth/policies/accept', {
        method: 'POST',
      });
      return {
        user: response.user,
        policyStatus: response.policyStatus ?? null,
      };
    },
    async deleteAccount() {
      await client.requestJson<null>('/api/auth/account', { method: 'DELETE' });
      client.clearAuthToken();
    },
    async logout() {
      await client.requestJson<null>('/api/auth/logout', { method: 'POST' });
      client.clearAuthToken();
    },
    async logoutAll() {
      await client.requestJson<null>('/api/auth/logout-all', { method: 'POST' });
      client.clearAuthToken();
    },
  };
}
