import type {
  Punishment,
  StaffPunishmentsPayload,
  StaffRoleUpdatePayload,
  StaffRoleUpdateRequest,
  StaffSummary,
  StaffUsersPayload,
} from '../../../common';
import type { AyphrRequestClient } from './client';

export function createStaffApi(client: AyphrRequestClient) {
  return {
    async summary() {
      return client.requestJson<StaffSummary>('/api/staff/summary');
    },
    async listUsers() {
      const response = await client.requestJson<StaffUsersPayload>('/api/staff/users');
      return response.users;
    },
    async updateRole(userUuid: string, input: StaffRoleUpdateRequest) {
      const response = await client.requestJson<StaffRoleUpdatePayload>(`/api/staff/role/${userUuid}`, {
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
  };
}
