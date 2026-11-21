import type { DataPoint, Device, DeviceSummary, DeviceUploadTokenInfo, DeviceUptime } from './device';
import type { Location } from './location';
import type { CountryOption } from '../utils/country';
import type { Punishment } from './punishment';
import type { SessionInfo } from './session';
import type { CreditBalance } from './credits';
import type { AssistantState } from './assistant';
import type {
  SubscriptionTier,
} from './subscription';
import type { PolicyAgreements, PolicyKey, PolicyVersions, PublicUser, SelfUser, UserRole } from './user';
import type { QueryType } from './queries';
export { MAX_STANDARD_QUERY_POINTS as MAX_QUERY_POINTS } from './queries';

export type PolicyStatus = {
  upToDate: boolean;
  pending: PolicyKey[];
  current: PolicyVersions;
  updatedDates: Partial<Record<PolicyKey, string>>;
  accepted: PolicyAgreements;
};

export type AuthSession = {
  user: SelfUser;
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
  user: SelfUser;
  token: string;
  suspension?: Punishment | null;
  policyStatus: PolicyStatus | null;
  expiresAt?: Date;
};

export type AuthMePayload = {
  user: SelfUser;
  suspension: Punishment | null;
  policyStatus: PolicyStatus | null;
};

export type UserMePayload = {
  user: SelfUser;
  activeSuspension: Punishment | null;
  policyStatus: PolicyStatus | null;
  credits: CreditBalance;
};

export type AssistantStatePayload = {
  state: AssistantState;
};

export type AcceptPoliciesPayload = {
  user: SelfUser;
  policyStatus: PolicyStatus | null;
};

export type ProfileMePayload = {
  user: SelfUser;
};

export type ProfileCountriesPayload = {
  countries: CountryOption[];
};

export type PunishmentsMePayload = {
  user: SelfUser;
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

export type DeviceUptimePayload = {
  uptime: DeviceUptime;
};

export type DeviceDataPointsPayload = {
  serial: number;
  period: string;
  dataPoints: DataPoint[];
  totalCount: number;
};

export type DeviceQueryRequest = {
  query: string;
  period?: string;
  from?: string;
  to?: string;
  type?: QueryType;
};

export type MultiDeviceQueryRequest = DeviceQueryRequest & {
  serials: number[];
};

export type DeviceQueryTarget = {
  serial: number;
  name?: string;
};

export type DeviceQueryPayload = {
  /** Serials included in the query context. */
  serials: number[];
  /** Present only for legacy single-device responses. */
  serial?: number;
  devices?: DeviceQueryTarget[];
  query: string;
  type: QueryType;
  result: unknown;
  rowCount: number | null;
  dataPointCount: number;
  totalCount: number;
  truncated: boolean;
  computeUnits: number;
  creditCost: number;
  durationMs: number;
};

export type DeviceUpdateRequest = {
  name?: string;
  locationId?: string;
};

export type DeviceUpdatePayload = {
  device: Device;
};

export type DeviceUnlinkPayload = {
  unlinked: boolean;
  serial: number;
};

export type DeviceTokenListPayload = {
  tokens: DeviceUploadTokenInfo[];
};

// Aliases for alternate naming.
export type DeviceTokensPayload = DeviceTokenListPayload;
export type DeviceUploadTokensPayload = DeviceTokenListPayload;

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

export type EmailCodeSentPayload = {
  expiresAt: Date;
};

export type PasswordForgotRequest = {
  identifier: string;
};

export type PasswordResetRequest = {
  identifier: string;
  code: string;
  newPassword: string;
};

export type EmailChangeRequest = {
  email: string;
  currentPassword: string;
};

export type EmailConfirmRequest = {
  email: string;
  code: string;
};

export type EmailConfirmPayload = {
  user: SelfUser;
};

export type DeviceVerificationRequiredPayload = {
  requiresDeviceVerification: true;
  expiresAt: Date;
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
