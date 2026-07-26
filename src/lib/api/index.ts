import { createAuthApi } from './auth';
import { createDevicesApi } from './devices';
import { createMarketApi } from './market';
import { createAyphrRequestClient, type ApiClientConfig, type AyphrRequestClient } from './client';
import { createPunishmentsApi } from './punishments';
import { createStaffApi } from './staff';
import { createUsersApi } from './users';
import { createProfileApi } from './profile';

export const API_BASE_URL = import.meta.env.DEV
  ? 'http://localhost:8080'
  : 'https://ayphrapi.proplayer919.dev:8080';

export type AyphrApiClient = AyphrRequestClient & {
  getStatus: () => Promise<string>;
  auth: ReturnType<typeof createAuthApi>;
  users: ReturnType<typeof createUsersApi>;
  profile: ReturnType<typeof createProfileApi>;
  punishments: ReturnType<typeof createPunishmentsApi>;
  devices: ReturnType<typeof createDevicesApi>;
  staff: ReturnType<typeof createStaffApi>;
  market: ReturnType<typeof createMarketApi>;
};

export function createAyphrApiClient(config: ApiClientConfig = {}): AyphrApiClient {
  const client = createAyphrRequestClient({
    baseUrl: API_BASE_URL,
    ...config,
  });

  return {
    ...client,
    async getStatus() {
      return client.requestText('/api/status', { auth: false });
    },
    auth: createAuthApi(client),
    users: createUsersApi(client),
    profile: createProfileApi(client),
    punishments: createPunishmentsApi(client),
    devices: createDevicesApi(client),
    staff: createStaffApi(client),
    market: createMarketApi(client),
  };
}

export const api = createAyphrApiClient();
