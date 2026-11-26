import { createAuthApi } from './auth';
import { createDevicesApi } from './devices';
import { createAlertsApi } from './alerts';
import { createLocationsApi } from './locations';
import { createGamesApi } from './games';
import { createRequestClient, type ApiClientConfig, type RequestClient } from './client';
import { createPunishmentsApi } from './punishments';
import { createStaffApi } from './staff';
import { createUsersApi } from './users';
import { createProfileApi } from './profile';
import { createSessionsApi } from './sessions';

import { createCreditsApi } from './credits';
import { createTeamsApi } from './teams';
import { createNotificationsApi } from './notifications';
import { createIntegrationsApi } from './integrations';
import { createAssistantApi } from './assistant';
import { createQueriesApi } from './queries';
import { getSafeRedirect } from '../redirects';
import { API_PATHS, apiPath } from './generated/routes';
import { queryClient, queryKeys } from '../query';
import { clearAccountQueryCache, clearSensitiveQueryState } from '../query/cacheLifecycle';
import { setUsersMeInvalidator } from './users';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? 'http://localhost:7233' : 'https://api.ayphr.com');

export type AyphrApiClient = RequestClient & {
  getStatus: () => Promise<string>;
  auth: ReturnType<typeof createAuthApi>;
  games: ReturnType<typeof createGamesApi>;
  users: ReturnType<typeof createUsersApi>;
  profile: ReturnType<typeof createProfileApi>;
  punishments: ReturnType<typeof createPunishmentsApi>;
  devices: ReturnType<typeof createDevicesApi>;
  alerts: ReturnType<typeof createAlertsApi>;
  locations: ReturnType<typeof createLocationsApi>;
  staff: ReturnType<typeof createStaffApi>;
  sessions: ReturnType<typeof createSessionsApi>;
  credits: ReturnType<typeof createCreditsApi>;
  teams: ReturnType<typeof createTeamsApi>;
  notifications: ReturnType<typeof createNotificationsApi>;
  integrations: ReturnType<typeof createIntegrationsApi>;
  assistant: ReturnType<typeof createAssistantApi>;
  queries: ReturnType<typeof createQueriesApi>;
};

export function createApiClient(config: ApiClientConfig = {}): AyphrApiClient {
  setUsersMeInvalidator(() => queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap() }));
  const client = createRequestClient({
    baseUrl: API_BASE_URL,
    onUnauthorized: () => {
      void clearSensitiveQueryState(queryClient);
      if (globalThis.window === undefined) return;
      if (!globalThis.location.pathname.startsWith('/auth')) {
        const redirect = encodeURIComponent(getSafeRedirect(globalThis.location.pathname + globalThis.location.search));
        globalThis.location.assign(`/auth/login?redirect=${redirect}`);
      }
    },
    onAccountSwitch: async () => {
      await clearAccountQueryCache(queryClient);
    },
    onAuthCleared: async () => {
      await clearSensitiveQueryState(queryClient);
    },
    ...config,
  });

  return {
    ...client,
    async getStatus() {
      return client.requestText(apiPath(API_PATHS.getStatus), { auth: false });
    },
    auth: createAuthApi(client),
    users: createUsersApi(client),
    profile: createProfileApi(client),
    punishments: createPunishmentsApi(client),
    devices: createDevicesApi(client),
    alerts: createAlertsApi(client),
    locations: createLocationsApi(client),
    games: createGamesApi(client),
    staff: createStaffApi(client),
    sessions: createSessionsApi(client),
    credits: createCreditsApi(client),
    teams: createTeamsApi(client),
    notifications: createNotificationsApi(client),
    integrations: createIntegrationsApi(client),
    assistant: createAssistantApi(client),
    queries: createQueriesApi(client),
  };
}

export const api = createApiClient();
