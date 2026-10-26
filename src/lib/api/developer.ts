import type { AppSummary, CreateAppRequest, CreateAppResponse, UpdateAppRequest } from '../../../common';
import type { RequestClient } from './client';

export function createDeveloperApi(client: RequestClient) {
  return {
    async listApps() {
      const response = await client.requestJson<{ apps: AppSummary[] }>('/api/developer/apps');
      return response.apps;
    },
    async createApp(input: CreateAppRequest) {
      return client.requestJson<CreateAppResponse>('/api/developer/apps', {
        method: 'POST',
        body: input,
      });
    },
    async getApp(id: string) {
      const response = await client.requestJson<{ app: AppSummary }>(`/api/developer/apps/${id}`);
      return response.app;
    },
    async updateApp(id: string, input: UpdateAppRequest) {
      const response = await client.requestJson<{ app: AppSummary }>(`/api/developer/apps/${id}`, {
        method: 'PATCH',
        body: input,
      });
      return response.app;
    },
    async deleteApp(id: string) {
      await client.requestJson<null>(`/api/developer/apps/${id}`, { method: 'DELETE' });
    },
    async regenerateSecret(id: string) {
      return client.requestJson<{ clientId: string; clientSecret: string }>(`/api/developer/apps/${id}/regenerate-secret`, {
        method: 'POST',
      });
    },
  };
}
