import type { Device } from './device';
import type { Punishment } from './punishment';
import type { SessionInfo } from './session';
import type {
  AttachedSubscription,
  BillingInterval,
  PaidSubscription,
  ResolvedSubscription,
  SubscriptionPlan,
  SubscriptionTier,
} from './subscription';
import type { PolicyAgreements, PolicyKey, PolicyVersions, PublicUser, UserRole } from './user';

export type PolicyStatus = {
  upToDate: boolean;
  pending: PolicyKey[];
  current: PolicyVersions;
  updatedDates: Partial<Record<PolicyKey, string>>;
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

export type SessionListPayload = {
  sessions: SessionInfo[];
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

export type StaffSubscriptionAttachRequest = {
  tier: SubscriptionTier;
  expiresAt?: string | null;
  reason?: string;
};

export type StaffSubscriptionUpdateRequest = {
  tier?: SubscriptionTier;
  expiresAt?: string | null;
  reason?: string;
};

export type StaffSubscriptionPayload = {
  user: PublicUser;
};

export type StaffSubscriptionListPayload = {
  subscriptions: AttachedSubscription[];
};

export type StaffSubscriptionUpdatePayload = {
  subscription: AttachedSubscription;
};

export type SubscriptionMePayload = {
  subscription: ResolvedSubscription | null;
  paidSubscription: PaidSubscription | null;
  attachedSubscriptions: AttachedSubscription[];
  plans: SubscriptionPlan[];
  trialDays: number;
};

export type SubscriptionCheckoutRequest = {
  tier: SubscriptionTier;
  interval: BillingInterval;
};

export type SubscriptionCheckoutPayload = {
  url: string;
};

export type SubscriptionAutoRenewRequest = {
  autoRenew: boolean;
};

export type SubscriptionAutoRenewPayload = {
  paidSubscription: PaidSubscription;
};

export type SubscriptionPortalPayload = {
  url: string;
};
