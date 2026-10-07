import { createAuthApi } from './auth';
import { createDevicesApi } from './devices';
import { createRequestClient, type ApiClientConfig, type RequestClient } from './client';
import { createPunishmentsApi } from './punishments';
import { createStaffApi } from './staff';
import { createUsersApi } from './users';
import { createProfileApi } from './profile';

export const API_BASE_URL = import.meta.env.DEV
  ? 'http://localhost:7233'
  : 'https://api.ayphr.com:7233';

export type AyphrApiClient = RequestClient & {
  getStatus: () => Promise<string>;
  auth: ReturnType<typeof createAuthApi>;
  users: ReturnType<typeof createUsersApi>;
  profile: ReturnType<typeof createProfileApi>;
  punishments: ReturnType<typeof createPunishmentsApi>;
  devices: ReturnType<typeof createDevicesApi>;
  staff: ReturnType<typeof createStaffApi>;
};

export function createApiClient(config: ApiClientConfig = {}): AyphrApiClient {
  const client = createRequestClient({
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
  };
}

export const api = createApiClient();
