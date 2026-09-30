import type { BioFormat } from '../utils/bio';

export type UserRole = 'user' | 'staff';
export type SocialLinkType = 'website' | 'youtube' | 'github' | 'bluesky' | 'reddit' | 'x' | 'facebook' | 'instagram' | 'tiktok';

export type SocialLinks = Partial<Record<SocialLinkType, string>>;

export type User = {
  uuid: string;
  username: string;
  role: UserRole;
  bio?: string;
  /** `markdown` unlocks the full dialect, which only staff may author. */
  bioFormat?: BioFormat;
  socialLinks?: SocialLinks;
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
