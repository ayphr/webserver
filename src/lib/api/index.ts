import { createAuthApi } from './auth';
import { createOAuthApi } from './oauth';
import { createDeveloperApi } from './developer';
import { createConnectionsApi } from './connections';
import { createDevicesApi } from './devices';
import { createLocationsApi } from './locations';
import { createGamesApi } from './games';
import { createRequestClient, type ApiClientConfig, type RequestClient } from './client';
import { createPunishmentsApi } from './punishments';
import { createStaffApi } from './staff';
import { createUsersApi } from './users';
import { createProfileApi } from './profile';
import { createSessionsApi } from './sessions';
import { createSubscriptionsApi } from './subscriptions';

export const API_BASE_URL = import.meta.env.DEV
  ? 'http://localhost:7233'
  : 'https://api.ayphr.com';

export type AyphrApiClient = RequestClient & {
  getStatus: () => Promise<string>;
  auth: ReturnType<typeof createAuthApi>;
  games: ReturnType<typeof createGamesApi>;
  oauth: ReturnType<typeof createOAuthApi>;
  developer: ReturnType<typeof createDeveloperApi>;
  connections: ReturnType<typeof createConnectionsApi>;
  users: ReturnType<typeof createUsersApi>;
  profile: ReturnType<typeof createProfileApi>;
  punishments: ReturnType<typeof createPunishmentsApi>;
  devices: ReturnType<typeof createDevicesApi>;
  locations: ReturnType<typeof createLocationsApi>;
  staff: ReturnType<typeof createStaffApi>;
  sessions: ReturnType<typeof createSessionsApi>;
  subscriptions: ReturnType<typeof createSubscriptionsApi>;
};

export function createApiClient(config: ApiClientConfig = {}): AyphrApiClient {
  const client = createRequestClient({
    baseUrl: API_BASE_URL,
    onUnauthorized: () => {
      if (globalThis.window === undefined) return;
      if (!globalThis.location.pathname.startsWith('/auth')) {
        globalThis.location.assign('/auth/login');
      }
    },
    ...config,
  });

  return {
    ...client,
    async getStatus() {
      return client.requestText('/api/status', { auth: false });
    },
    auth: createAuthApi(client),
    oauth: createOAuthApi(client),
    developer: createDeveloperApi(client),
    connections: createConnectionsApi(client),
    users: createUsersApi(client),
    profile: createProfileApi(client),
    punishments: createPunishmentsApi(client),
    devices: createDevicesApi(client),
  locations: createLocationsApi(client),
  games: createGamesApi(client),
    staff: createStaffApi(client),
    sessions: createSessionsApi(client),
    subscriptions: createSubscriptionsApi(client),
  };
}

export const api = createApiClient();
