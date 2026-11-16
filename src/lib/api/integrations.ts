import type { IntegrationListPayload, IntegrationPayload, IntegrationCreateRequest, IntegrationUpdateRequest, IntegrationTestPayload } from '@common';
import type { RequestClient } from './client';

export function createIntegrationsApi(client: RequestClient) {
  return {
    async listMine() {
      const response = await client.requestJson<IntegrationListPayload>('/api/integrations');
      return response.integrations;
    },
    async create(input: IntegrationCreateRequest) {
      const response = await client.requestJson<IntegrationPayload>('/api/integrations', {
        method: 'POST',
        body: input,
      });
      return response.integration;
    },
    async get(id: string) {
      const response = await client.requestJson<IntegrationPayload>(`/api/integrations/${encodeURIComponent(id)}`);
      return response.integration;
    },
    async update(id: string, input: IntegrationUpdateRequest) {
      const response = await client.requestJson<IntegrationPayload>(`/api/integrations/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: input,
      });
      return response.integration;
    },
    async remove(id: string) {
      await client.requestJson(`/api/integrations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
    },
    async test(id: string) {
      const response = await client.requestJson<IntegrationTestPayload>(`/api/integrations/${encodeURIComponent(id)}/test`, {
        method: 'POST',
      });
      return response;
    },
  };
}