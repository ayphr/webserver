// Use raw JS Date objects for timestamps.

export type UserRole = 'user' | 'staff' | 'owner';

export type SocialLinkType = 'website' | 'youtube' | 'github' | 'bluesky' | 'reddit' | 'x' | 'facebook' | 'instagram' | 'tiktok';

export type SocialLinks = Partial<Record<SocialLinkType, string>>;

export type User = {
  uuid: string;
  username: string;
  role: UserRole;
  bio?: string;
  socialLinks?: SocialLinks;
  auth: {
    token?: string;
    issuedAt?: Date;
    passwordHash?: string;
  };
  createdAt: Date;
  lastActive: Date;
  credits?: number;
  country?: string;
};

export type PublicUser = Omit<User, 'auth' | 'credits'>;
