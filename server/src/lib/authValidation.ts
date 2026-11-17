import { optionalBoolean, optionalString, requireJsonObject, type JsonObject } from '@common';

export type AuthPayload = JsonObject & {
  username?: string;
  password?: string;
  email?: string;
  code?: string;
  currentPassword?: string;
  newPassword?: string;
  country?: string;
  acceptPolicies?: boolean;
  timezone?: string;
  locale?: string;
  deviceType?: string;
  inviteToken?: string;
};

export function validateAuthPayload(value: unknown): AuthPayload {
  const body = requireJsonObject(value);
  return {
    ...body,
    username: optionalString(body, 'username', { maxLength: 64 }),
    password: optionalString(body, 'password', { maxLength: 256, trim: false }),
    email: optionalString(body, 'email', { maxLength: 254 }),
    code: optionalString(body, 'code', { maxLength: 32 }),
    currentPassword: optionalString(body, 'currentPassword', { maxLength: 256, trim: false }),
    newPassword: optionalString(body, 'newPassword', { maxLength: 256, trim: false }),
    country: optionalString(body, 'country', { maxLength: 2 }),
    acceptPolicies: optionalBoolean(body, 'acceptPolicies'),
    timezone: optionalString(body, 'timezone', { maxLength: 64 }),
    locale: optionalString(body, 'locale', { maxLength: 64 }),
    deviceType: optionalString(body, 'deviceType', { maxLength: 32 }),
    inviteToken: optionalString(body, 'inviteToken', { maxLength: 128 }),
  };
}
