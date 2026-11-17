import type {
  Punishment,
  StaffPasswordUpdatePayload,
  StaffPasswordUpdateRequest,
  StaffPunishmentsPayload,
  StaffRoleUpdatePayload,
  StaffRoleUpdateRequest,
  StaffSummary,
  StaffUsersPayload,
  StaffUsersQuery,
} from '@common';
import type { Appeal } from '@common';
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
      if (query.status) params.set('status', query.status);
      if (query.page) params.set('page', String(query.page));
      if (query.pageSize) params.set('pageSize', String(query.pageSize));

      const search = params.toString();
      return client.requestJson<StaffUsersPayload>(`/api/staff/users${search ? `?${search}` : ''}`);
    },
    async deleteUser(userUuid: string) {
      await client.requestJson(`/api/staff/users/${encodeURIComponent(userUuid)}`, { method: 'DELETE' });
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
    appeals: {
    async list() {
      const response = await client.requestJson<{ appeals: Appeal[] }>('/api/staff/appeals');
      return response.appeals;
    },
    async resolve(appealId: string, decision: 'lift' | 'deny') {
      await client.requestJson(`/api/staff/appeals/${encodeURIComponent(appealId)}/resolve`, {
        method: 'POST',
        body: { decision },
      });
    },
  },
  users: {
    async teams(userUuid: string) {
      const response = await client.requestJson<{ teams: { team: import('@common').Team; role: string }[] }>(`/api/staff/users/${userUuid}/teams`);
      return response.teams;
    },
    async credits(userUuid: string) {
      const response = await client.requestJson<{ credits: import('@common').CreditBalance }>(`/api/staff/users/${userUuid}/credits`);
      return response.credits;
    },
    async devices(userUuid: string) {
      const response = await client.requestJson<{ devices: import('@common').DeviceSummary[] }>(`/api/staff/users/${userUuid}/devices`);
      return response.devices;
    },
    async locations(userUuid: string) {
      const response = await client.requestJson<{ locations: import('@common').Location[] }>(`/api/staff/users/${userUuid}/locations`);
      return response.locations;
    },
  },
  teams: {
    async update(teamId: string, input: { tier?: string; seats?: number; gifted?: boolean }) {
      const response = await client.requestJson<{ team: import('@common').Team }>(`/api/staff/teams/${teamId}`, {
        method: 'PATCH',
        body: input,
      });
      return response.team;
    },
    async delete(teamId: string) {
      await client.requestJson(`/api/staff/teams/${teamId}`, { method: 'DELETE' });
    },
    async updateMemberRole(teamId: string, userUuid: string, role: string) {
      await client.requestJson(`/api/staff/teams/${teamId}/members/${userUuid}/role`, {
        method: 'PATCH',
        body: { role },
      });
    },
    async removeMember(teamId: string, userUuid: string) {
      await client.requestJson(`/api/staff/teams/${teamId}/members/${userUuid}`, { method: 'DELETE' });
    },
  },
};
}
