export type SessionDeviceType = 'desktop' | 'mobile' | 'tablet';

/** Approximate location of a session, derived from the client's timezone and locale. */
export type SessionLocation = {
  city?: string;
  region?: string;
  /** ISO 3166-1 alpha-2 country code. */
  country?: string;
  countryName?: string;
  timezone?: string;
};

/** A tracked login session. The token is intentionally never exposed. */
export type Session = {
  id: string;
  userUuid: string;
  token: string;
  createdAt: Date;
  lastActive: Date;
  expiresAt: Date;
  userAgent?: string;
  browser?: string;
  os?: string;
  deviceType?: SessionDeviceType;
  location: SessionLocation;
};

/** A session as presented to its owner, with `current` marking the requesting session. */
export type SessionInfo = Omit<Session, 'token' | 'userUuid'> & {
  current: boolean;
};
