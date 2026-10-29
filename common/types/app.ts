export type AppScope = string;

export const KNOWN_APP_SCOPES = [
  'identify',
  'profile.read',
  'profile.write',
  'devices.read',
  'devices.control',
  'connections.read',
] as const;

export type KnownAppScope = (typeof KNOWN_APP_SCOPES)[number];

export type App = {
  id: string;
  clientId: string;
  ownerId: string;
  name: string;
  description?: string;
  homepageUrl: string;
  logoUrl?: string;
  tosUrl?: string;
  privacyUrl?: string;
  redirectUris: string[];
  allowedScopes: AppScope[];
  clientSecretHash: string;
  createdAt: Date;
  updatedAt: Date;
};

export type PublicApp = Omit<App, 'clientSecretHash'>;

export type AppSummary = {
  id: string;
  clientId: string;
  name: string;
  description?: string;
  homepageUrl: string;
  logoUrl?: string;
  tosUrl?: string;
  privacyUrl?: string;
  redirectUris: string[];
  allowedScopes: AppScope[];
  createdAt: Date;
  updatedAt: Date;
};

export type CreateAppRequest = {
  name: string;
  description?: string;
  homepageUrl: string;
  logoUrl?: string;
  tosUrl?: string;
  privacyUrl?: string;
  redirectUris?: string[];
  allowedScopes?: AppScope[];
};

export type UpdateAppRequest = Partial<CreateAppRequest>;

export type CreateAppResponse = {
  app: AppSummary;
  clientId: string;
  clientSecret: string;
};

export type OAuthAuthorizationRequest = {
  clientId: string;
  redirectUri: string;
  scope?: string;
  state?: string;
  responseType?: string;
};

export type OAuthTokenRequest = {
  grantType: 'authorization_code' | 'refresh_token';
  code?: string;
  clientId: string;
  clientSecret?: string;
  redirectUri?: string;
  refreshToken?: string;
  codeVerifier?: string;
};

export type OAuthTokenResponse = {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  scope: string;
  refreshToken?: string;
};

export type OAuthAuthorizationCode = {
  codeHash: string;
  appId: string;
  clientId: string;
  userId: string;
  redirectUri: string;
  scopes: AppScope[];
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
  codeChallenge?: string;
  codeChallengeMethod?: 'plain' | 'S256';
};

export type OAuthAccessToken = {
  tokenHash: string;
  appId: string;
  clientId: string;
  userId: string;
  scopes: AppScope[];
  connectionId: string;
  expiresAt: Date;
  createdAt: Date;
  revokedAt?: Date;
};

export type ConnectionActivity = {
  method: string;
  path: string;
  scopes: AppScope[];
  at: Date;
};

export type Connection = {
  id: string;
  userId: string;
  appId: string;
  clientId: string;
  appName: string;
  appLogoUrl?: string;
  appHomepageUrl?: string;
  scopes: AppScope[];
  createdAt: Date;
  lastUsedAt?: Date;
  revokedAt?: Date;
  recentActivity?: ConnectionActivity[];
};

export type ConnectionListPayload = {
  connections: Connection[];
};
