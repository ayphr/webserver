import type { Device } from './device';
import type { Punishment } from './punishment';
import type { PolicyAgreements, PolicyKey, PolicyVersions, PublicUser, UserRole } from './user';

/**
 * Whether a user has agreed to the latest published policies.
 * `null` when the latest versions could not be determined.
 */
export type PolicyStatus = {
  upToDate: boolean;
  pending: PolicyKey[];
  current: PolicyVersions;
  accepted: PolicyAgreements;
};

export type AuthSession = {
  user: PublicUser;
  token: string;
  suspension?: Punishment | null;
  policyStatus: PolicyStatus | null;
};

export type AuthMeResponse = {
  user: PublicUser;
  suspension: Punishment | null;
  policyStatus: PolicyStatus | null;
};

export type UserMeResponse = {
  user: PublicUser;
  activeSuspension: Punishment | null;
  policyStatus: PolicyStatus | null;
};

export type ProfileMeResponse = {
  user: PublicUser;
};

export type CountryOption = {
  code: string;
  name: string;
};

export type ProfileCountriesResponse = {
  countries: CountryOption[];
};

export type PunishmentsMeResponse = {
  user: PublicUser;
  activeSuspension: Punishment | null;
  punishments: Punishment[];
};

export type StaffSummary = {
  userCount: number;
  staffCount: number;
};

export type ApiErrorBody = {
  error?: string;
  message?: string;
  suspension?: Punishment;
};

export type AuthResponsePayload = {
  user: PublicUser;
  token: string;
  suspension?: Punishment | null;
  policyStatus: PolicyStatus | null;
};

export type AuthMePayload = {
  user: PublicUser;
  suspension: Punishment | null;
  policyStatus: PolicyStatus | null;
};

export type UserMePayload = {
  user: PublicUser;
  activeSuspension: Punishment | null;
  policyStatus: PolicyStatus | null;
};

export type AcceptPoliciesPayload = {
  user: PublicUser;
  policyStatus: PolicyStatus | null;
};

export type ProfileMePayload = {
  user: PublicUser;
};

export type ProfileCountriesPayload = {
  countries: CountryOption[];
};

export type PunishmentsMePayload = {
  user: PublicUser;
  activeSuspension: Punishment | null;
  punishments: Punishment[];
};

export type DeviceListPayload = {
  devices: Device[];
};

export type DevicePayload = {
  device: Device;
};

export type PunishmentPayload = {
  punishment: Punishment;
};

export type StaffUsersPayload = {
  users: PublicUser[];
};

export type StaffPunishmentsPayload = {
  punishments: Punishment[];
};

export type StaffRoleUpdatePayload = {
  user: PublicUser;
};

export type StaffRoleUpdateRequest = {
  role: UserRole;
};
