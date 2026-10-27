import type {
  Punishment,
  StaffPasswordUpdatePayload,
  StaffPasswordUpdateRequest,
  StaffPunishmentsPayload,
  StaffRoleUpdatePayload,
  StaffRoleUpdateRequest,
  StaffSubscriptionAttachRequest,
  StaffSubscriptionListPayload,
  StaffSubscriptionPayload,
  StaffSubscriptionUpdatePayload,
  StaffSubscriptionUpdateRequest,
  StaffSummary,
  StaffUsersPayload,
  StaffUsersQuery,
} from '@common';
import type { RequestClient } from './client';

export function createStaffApi(client: RequestClient) {
  return {
    async summary() {
      return client.requestJson<StaffSummary>('/api/staff/summary');
    },
    async listUsers(query: StaffUsersQuery = {}) {
      const params = new URLSearchParams();

      if (query.search?.trim()) params.set('q', query.search.trim());
      if (query.role) params.set('role', query.role);
      if (query.tier) params.set('tier', query.tier);
      if (query.source) params.set('source', query.source);
      if (query.status) params.set('status', query.status);
      if (query.page) params.set('page', String(query.page));
      if (query.pageSize) params.set('pageSize', String(query.pageSize));

      const search = params.toString();
      return client.requestJson<StaffUsersPayload>(`/api/staff/users${search ? `?${search}` : ''}`);
    },
    async updateRole(userUuid: string, input: StaffRoleUpdateRequest) {
      const response = await client.requestJson<StaffRoleUpdatePayload>(`/api/staff/role/${userUuid}`, {
        method: 'POST',
        body: input,
      });
      return response.user;
    },
    async setPassword(userUuid: string, input: StaffPasswordUpdateRequest) {
      const response = await client.requestJson<StaffPasswordUpdatePayload>(`/api/staff/password/${userUuid}`, {
        method: 'POST',
        body: input,
      });
      return response.user;
    },
    punishments: {
      async list() {
        const response = await client.requestJson<StaffPunishmentsPayload>('/api/staff/punishments');
        return response.punishments;
      },
      async issue(input: { username?: string; userUuid?: string; reason: string; durationMinutes?: number }) {
        const response = await client.requestJson<{ punishment: Punishment }>('/api/staff/punishments', {
          method: 'POST',
          body: input,
        });
        return response.punishment;
      },
      async lift(punishmentId: string) {
        const response = await client.requestJson<{ punishment: Punishment }>(`/api/staff/punishments/${punishmentId}/lift`, {
          method: 'POST',
        });
        return response.punishment;
      },
    },
    subscriptions: {
      async list(userUuid: string) {
        const response = await client.requestJson<StaffSubscriptionListPayload>(`/api/staff/subscriptions/${userUuid}`);
        return response.subscriptions;
      },
      async attach(userUuid: string, input: StaffSubscriptionAttachRequest) {
        const response = await client.requestJson<StaffSubscriptionPayload>(`/api/staff/subscriptions/${userUuid}`, {
          method: 'POST',
          body: input,
        });
        return response.user;
      },
      async update(userUuid: string, subscriptionId: string, input: StaffSubscriptionUpdateRequest) {
        const response = await client.requestJson<StaffSubscriptionUpdatePayload>(
          `/api/staff/subscriptions/${userUuid}/${subscriptionId}`,
          { method: 'PATCH', body: input },
        );
        return response.subscription;
      },
      async detach(userUuid: string, subscriptionId: string) {
        const response = await client.requestJson<StaffSubscriptionPayload>(
          `/api/staff/subscriptions/${userUuid}/${subscriptionId}`,
          { method: 'DELETE' },
        );
        return response.user;
      },
    },
  };
}
