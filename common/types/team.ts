import type { PaginationMeta, PaginationQuery } from './pagination';
import type { PlanTier } from './plans';
import type { TeamCredits } from './credits';
import type { BillingInterval, PaidSubscriptionStatus, SubscriptionPlan } from './subscription';

export type TeamRole = 'member' | 'helper' | 'manager';

export const TEAM_ROLES: readonly TeamRole[] = ['member', 'helper', 'manager'];

export function isTeamRole(value: unknown): value is TeamRole {
  return typeof value === 'string' && (TEAM_ROLES as readonly string[]).includes(value);
}

export type Team = {
  id: string;
  name?: string;
  managerUuid: string;
  tier: PlanTier;
  credits?: TeamCredits;
  createdAt: Date;
  updatedAt: Date;
  billingInterval?: BillingInterval;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  seats?: number;
  subscriptionStatus?: PaidSubscriptionStatus;
  currentPeriodEnd?: Date;
  gifted?: boolean;
};

export type TeamSubscriptionPayload = {
  team: Team;
  plans: SubscriptionPlan[];
  trialDays: number;
};

export type TeamMember = {
  uuid: string;
  username: string;
  role: TeamRole;
  joinedAt: Date;
};

export type TeamAuditLog = {
  id: string;
  teamId: string;
  actorUuid: string;
  actorUsername: string;
  action: string;
  targetUuid?: string;
  targetUsername?: string;
  details?: Record<string, unknown>;
  createdAt: Date;
};

export type TeamPayload = {
  team: Team;
  members: TeamMember[];
};

export type TeamMemberPayload = {
  member: TeamMember;
};

export type TeamAuditLogListQuery = PaginationQuery;

export type TeamAuditLogListPayload = {
  logs: TeamAuditLog[];
} & PaginationMeta;

export type TeamMemberAddRequest = {
  username?: string;
  uuid?: string;
  email?: string;
  role?: TeamRole;
};

export type TeamMemberRoleUpdateRequest = {
  role: TeamRole;
};

export type TeamInvite = {
  id: string;
  teamId: string;
  teamName?: string;
  email: string;
  role: TeamRole;
  token: string;
  invitedByUuid: string;
  invitedByUsername: string;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt?: Date;
  acceptedByUuid?: string;
};

export type TeamInvitePayload = {
  invite: TeamInvite;
};

export type TeamInviteListPayload = {
  invites: TeamInvite[];
};
