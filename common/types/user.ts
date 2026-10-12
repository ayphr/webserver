import type { MarkdownFormat } from '../utils/markdown';
import type { BadgeId } from './badges';
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

export type User = {
  uuid: string;
  username: string;
  role: UserRole;
  avatar?: UserAvatar;
  bio?: string;
  bioFormat?: MarkdownFormat;
  socialLinks?: SocialLinks;
  policyAgreements?: PolicyAgreements;
  auth: {
    passwordHash?: string;
  };
  createdAt: Date;
  lastActive: Date;
  country?: string;
  stripeCustomerId?: string;
  paidSubscriptions?: PaidSubscription[];
  attachedSubscriptions?: AttachedSubscription[];
};

export type PublicUser = Omit<
  User,
  'auth' | 'stripeCustomerId' | 'paidSubscriptions' | 'attachedSubscriptions' | 'avatar'
> & {
  badges: BadgeId[];
  avatarUrl?: string;
  subscription: PublicSubscription | null;
};
