import type { AcceptPoliciesPayload, AuthMePayload, AuthResponsePayload, AuthSession, ChangePasswordRequest, DeviceVerificationRequiredPayload, EmailChangeRequest, EmailCodeSentPayload, EmailConfirmPayload, EmailConfirmRequest, PasswordForgotRequest, PasswordResetRequest, SessionDeviceType } from '@common';
import type { RequestClient } from './client';
import { addStoredAccount, removeStoredAccount } from '../accounts';
import { API_PATHS, apiPath } from './generated/routes';

function getClientDeviceType(): SessionDeviceType | undefined {
  if (typeof navigator === 'undefined') return undefined;

  const userAgent = navigator.userAgent;
  const userAgentData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  const maxTouchPoints = navigator.maxTouchPoints ?? 0;

  const isTouchIpad = /Macintosh/.test(userAgent) && maxTouchPoints > 1;
  if (isTouchIpad || /iPad|Tablet|PlayBook|Silk|Kindle/i.test(userAgent)) return 'tablet';
  if (!userAgentData && /Android/i.test(userAgent) && !/Mobile/i.test(userAgent)) return 'tablet';

  const isMobile = userAgentData?.mobile ?? /Mobi|iPhone|iPod|Windows Phone|Android.*Mobile/i.test(userAgent);
  if (isMobile) return 'phone';

  if (/\b(SmartTV|Smart-TV|HbbTV|NetCast|Viera|BRAVIA|Roku|CrKey|AppleTV|GoogleTV)\b/i.test(userAgent)) return 'tv';

  if (maxTouchPoints > 0) return 'laptop';

  return 'desktop';
}

function getClientSessionMeta() {
  if (typeof navigator === 'undefined') return {};

  let timezone: string | undefined;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    timezone = undefined;
  }

  return { timezone, locale: navigator.language, deviceType: getClientDeviceType() };
}

/** Applies a successful auth response locally and returns the public session shape. */
function persistSession(client: RequestClient, response: AuthResponsePayload): AuthSession {
  client.setAuthToken(response.token);
  addStoredAccount(response.token, response.user, response.expiresAt);
  return {
    user: response.user,
    token: response.token,
    ...(response.suspension ? { suspension: response.suspension } : {}),
    policyStatus: response.policyStatus,
  };
}

/** Drops the current session from both the request client and the account store. */
function clearLocalSession(client: RequestClient): void {
  const token = client.getAuthToken();
  if (token) removeStoredAccount(token);
  client.clearAuthToken();
}

export function createAuthApi(client: RequestClient) {
  return {
    async register(input: { username: string; password: string; email: string; code: string; country?: string; acceptPolicies: boolean }) {
      const response = await client.requestJson<AuthResponsePayload>(apiPath(API_PATHS.postAuthRegister), {
        method: 'POST',
        auth: false,
        body: { ...input, ...getClientSessionMeta() },
      });

      return persistSession(client, response);
    },
    async login(input: { username: string; password: string }) {
      const response = await client.requestJson<AuthResponsePayload | DeviceVerificationRequiredPayload>(apiPath(API_PATHS.postAuthLogin), {
        method: 'POST',
        auth: false,
        body: { ...input, ...getClientSessionMeta() },
      });

      if ('requiresDeviceVerification' in response && response.requiresDeviceVerification) {
        return { requiresDeviceVerification: true as const, expiresAt: response.expiresAt };
      }

      return persistSession(client, response as AuthResponsePayload);
    },
    async verifyDeviceLogin(input: { username: string; code: string }) {
      const response = await client.requestJson<AuthResponsePayload>(apiPath(API_PATHS.postAuthLoginVerify), {
        method: 'POST',
        auth: false,
        body: { ...input, ...getClientSessionMeta() },
      });

      return persistSession(client, response);
    },
    async requestEmailCode(input: { email: string }) {
      const response = await client.requestJson<EmailCodeSentPayload>(apiPath(API_PATHS.postAuthEmailCode), {
        method: 'POST',
        auth: false,
        body: input,
      });
      return response;
    },
    async forgotPassword(input: PasswordForgotRequest) {
      const response = await client.requestJson<{ message: string; expiresAt?: Date }>(apiPath(API_PATHS.postAuthPasswordForgot), {
        method: 'POST',
        auth: false,
        body: input,
      });
      return { message: response.message, ...(response.expiresAt ? { expiresAt: response.expiresAt } : {}) };
    },
    async resetPassword(input: PasswordResetRequest) {
      await client.requestJson<null>(apiPath(API_PATHS.postAuthPasswordReset), {
        method: 'POST',
        auth: false,
        body: input,
      });
    },
    async requestEmailChange(input: EmailChangeRequest) {
      const response = await client.requestJson<EmailCodeSentPayload>(apiPath(API_PATHS.postAuthEmailChange), {
        method: 'POST',
        body: input,
      });
      return response;
    },
    async confirmEmailChange(input: EmailConfirmRequest) {
      const response = await client.requestJson<EmailConfirmPayload>(apiPath(API_PATHS.postAuthEmailConfirm), {
        method: 'POST',
        body: input,
      });
      return response.user;
    },
    async me() {
      const response = await client.requestJson<AuthMePayload>(apiPath(API_PATHS.getAuthMe));
      return {
        user: response.user,
        suspension: response.suspension || null,
        policyStatus: response.policyStatus ?? null,
      } satisfies AuthMePayload;
    },
    async acceptPolicies() {
      const response = await client.requestJson<AcceptPoliciesPayload>(apiPath(API_PATHS.postAuthPoliciesAccept), {
        method: 'POST',
      });
      return {
        user: response.user,
        policyStatus: response.policyStatus ?? null,
      };
    },
    async deleteAccount(input: { password: string }) {
      await client.requestJson<null>(apiPath(API_PATHS.deleteAuthAccount), {
        method: 'DELETE',
        body: { password: input.password },
      });
      clearLocalSession(client);
    },
    async changePassword(input: ChangePasswordRequest) {
      // All sessions (including this one) are revoked when the password changes,
      // so the client clears its token and lets the user sign back in.
      await client.requestJson<null>(apiPath(API_PATHS.postAuthPassword), {
        method: 'POST',
        body: input,
      });
      clearLocalSession(client);
    },
    async logout() {
      await client.requestJson<null>(apiPath(API_PATHS.postAuthLogout), { method: 'POST' });
      clearLocalSession(client);
    },
    async logoutAll() {
      await client.requestJson<null>(apiPath(API_PATHS.postAuthLogoutAll), { method: 'POST' });
      clearLocalSession(client);
    },
    async logoutOthers() {
      await client.requestJson<null>(apiPath(API_PATHS.postAuthLogoutOthers), { method: 'POST' });
    },
  };
}
