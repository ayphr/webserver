export type SessionDeviceType = 'desktop' | 'laptop' | 'phone' | 'tablet' | 'tv' | 'unknown';

export type SessionLocation = {
  city?: string;
  region?: string;
  country?: string;
  countryName?: string;
  timezone?: string;
};

export type Session = {
  id: string;
  userUuid: string;
  tokenHash: string;
  createdAt: Date;
  lastActive: Date;
  expiresAt: Date;
  userAgent?: string;
  browser?: string;
  os?: string;
  deviceType?: SessionDeviceType;
  location: SessionLocation;
};

export type SessionInfo = Omit<Session, 'tokenHash' | 'userUuid'> & {
  current: boolean;
};
