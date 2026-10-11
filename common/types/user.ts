import type { MarkdownFormat } from '../utils/markdown';

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

export type User = {
  uuid: string;
  username: string;
  role: UserRole;
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
};

export type PublicUser = Omit<User, 'auth'>;
