import type { Device, DeviceSummary } from './device';
import type { Location } from './location';
import type { CountryOption } from '../utils/country';
import type { Punishment } from './punishment';
import type { SessionInfo } from './session';
import type {
  AttachedSubscription,
  BillingInterval,
  PaidSubscription,
  ResolvedSubscription,
  SubscriptionPlan,
  SubscriptionSource,
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
  devices: DeviceSummary[];
};

export type LocationListPayload = {
  locations: Location[];
};

export type LocationPayload = {
  location: Location;
};

export type DevicePayload = {
  device: Device;
};

export type DeviceTokenPayload = {
  token: string;
  expiresAt: Date;
};

export type DeviceLinkPayload = {
  linked: boolean;
  device: Device;
};

export type DevicePairingRequestPayload = {
  code: string;
  expiresAt: Date;
};

export type DevicePairingTokenPayload = {
  token: string;
  expiresAt: Date;
  serial: number;
};

export type PunishmentPayload = {
  punishment: Punishment;
};

export type SessionListPayload = {
  sessions: SessionInfo[];
};

export type StaffUserSubscriptionStatus = 'active' | 'expired' | 'none';

export type StaffUsersQuery = {
  search?: string;
  role?: UserRole;
  tier?: SubscriptionTier;
  source?: SubscriptionSource;
  status?: StaffUserSubscriptionStatus;
  page?: number;
  pageSize?: number;
};

export type StaffUsersPayload = {
  users: PublicUser[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
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

export type StaffPasswordUpdateRequest = {
  password: string;
};

export type StaffPasswordUpdatePayload = {
  user: PublicUser;
};

export type ChangePasswordRequest = {
  currentPassword: string;
  newPassword: string;
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

export type DomainChallengeRequest = {
  type?: string;
  socialType?: string;
  linkType?: string;
  key?: string;
  platform?: string;
  domain?: string;
  handle?: string;
  value?: string;
};

export type DomainChallengePayload = {
  domain: string;
  type: string;
  token: string;
  recordName: string;
  recordValue: string;
  txtName: string;
  txtValue: string;
  name: string;
  value: string;
  expiresAt: Date;
  challenge?: string;
};

export type DomainVerifyRequest = {
  type?: string;
  socialType?: string;
  linkType?: string;
  key?: string;
  platform?: string;
  domain?: string;
  handle?: string;
  value?: string;
  token?: string;
  code?: string;
  challenge?: string;
};

export type DomainVerifyPayload = {
  verified: boolean;
  user: PublicUser;
};
