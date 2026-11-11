import type { MarkdownFormat } from '../utils/markdown';
import type { BadgeId } from './badges';
import type { UserCredits } from './credits';
import type {
  AttachedSubscription,
  PaidSubscription,
  PublicSubscription,
} from './subscription';

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
  bioFormat?: MarkdownFormat;
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
  developerAccount?: boolean;
  stripeCustomerId?: string;
  paidSubscriptions?: PaidSubscription[];
  attachedSubscriptions?: AttachedSubscription[];
  teamId?: string;
  teamRole?: 'member' | 'helper' | 'manager';
  credits?: UserCredits;
  trustedDevices?: string[];
};

export type PublicUser = Omit<
  User,
  'auth' | 'stripeCustomerId' | 'paidSubscriptions' | 'attachedSubscriptions' | 'avatar' | 'gameBests' | 'email' | 'emailVerifiedAt' | 'trustedDevices'
> & {
  badges: BadgeId[];
  avatarUrl?: string;
  subscription: PublicSubscription | null;
};

export type SelfUser = PublicUser & Pick<User, 'email' | 'emailVerifiedAt'>;
