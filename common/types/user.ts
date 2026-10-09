import type { MarkdownFormat } from '../utils/markdown';

export type UserRole = 'user' | 'staff';
export type SocialLinkType = 'website' | 'youtube' | 'github' | 'bluesky' | 'reddit' | 'x' | 'facebook' | 'instagram' | 'tiktok';

export type SocialLinks = Partial<Record<SocialLinkType, string>>;

/** Policies a user must agree to. */
export type PolicyKey = 'tos' | 'privacy';

/** The numeric policy version the user last agreed to, per policy. */
export type PolicyAgreements = Partial<Record<PolicyKey, number>>;

/** The latest published version of each policy, per policy. */
export type PolicyVersions = Record<PolicyKey, number>;

/**
 * The latest published policy versions plus their human-readable
 * updated dates (e.g. "October 2026"), when available.
 */
export type PolicyVersionsData = {
  versions: PolicyVersions;
  updatedDates: Partial<Record<PolicyKey, string>>;
};

export type User = {
  uuid: string;
  username: string;
  role: UserRole;
  bio?: string;
  /** `markdown` unlocks the full dialect, which only staff may author. */
  bioFormat?: MarkdownFormat;
  socialLinks?: SocialLinks;
  policyAgreements?: PolicyAgreements;
  auth: {
    token?: string;
    issuedAt?: Date;
    passwordHash?: string;
  };
  createdAt: Date;
  lastActive: Date;
  country?: string;
};

export type PublicUser = Omit<User, 'auth'>;
