import type { BadgeId } from './badges';

import type { PublicSubscription } from './subscription';

export type UserRole = 'user' | 'staff';
export type SocialLinkType = 'website' | 'youtube' | 'github' | 'bluesky' | 'reddit' | 'x' | 'facebook' | 'instagram' | 'tiktok';

export type SocialLinks = Partial<Record<SocialLinkType, string>>;

export type PolicyKey = 'tos' | 'privacy';

export type PolicyAgreements = Partial<Record<PolicyKey, number>>;

export type PolicyVersions = Record<PolicyKey, number>;

export type PolicyVersionsData = {
  versions: PolicyVersions;
  updatedDates: Partial<Record<PolicyKey, string>>;
};

export type UserAvatar = {
  contentType: string;
  size: number;
  updatedAt: Date;
};

export type GameBest = {
  value: number;
  achievedAt: Date;
};

export type GameBests = {
  memory?: GameBest;
  minesweeper?: GameBest;
};

export type User = {
  uuid: string;
  username: string;
  email?: string;
  emailVerifiedAt?: Date;
  role: UserRole;
  avatar?: UserAvatar;
  bio?: string;
  socialLinks?: SocialLinks;
  socialLinkVerified?: Partial<Record<SocialLinkType, boolean>>;
  policyAgreements?: PolicyAgreements;
  auth: {
    passwordHash?: string;
  };
  createdAt: Date;
  lastActive: Date;
  country?: string;
  gameBests?: GameBests;
  teamId?: string;
  teamRole?: 'member' | 'helper' | 'manager';
  teamIds?: string[];
  teamRoles?: Record<string, 'member' | 'helper' | 'manager'>;
  trustedDevices?: string[];
  usernameChangedAt?: Date;
};

export type PublicUser = Omit<
  User,
  'auth' | 'avatar' | 'gameBests' | 'email' | 'emailVerifiedAt' | 'trustedDevices'
> & {
  badges: BadgeId[];
  avatarUrl?: string;
  subscription: PublicSubscription | null;
};

export type SelfUser = PublicUser & Pick<User, 'email' | 'emailVerifiedAt'>;
