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
import { API_PATHS, apiPath } from './generated/routes';

export function createStaffApi(client: RequestClient) {
  return {
    async summary() {
      return client.requestJson<StaffSummary>(apiPath(API_PATHS.getStaffSummary));
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
      return client.requestJson<StaffUsersPayload>(apiPath(API_PATHS.getStaffUsers, {}, search ? `?${search}` : ''));
    },
    async deleteUser(userUuid: string) {
      await client.requestJson(apiPath(API_PATHS.deleteStaffUsersUuid, { uuid: userUuid }), { method: 'DELETE' });
    },
    async updateRole(userUuid: string, input: StaffRoleUpdateRequest) {
      const response = await client.requestJson<StaffRoleUpdatePayload>(apiPath(API_PATHS.postStaffRoleUuid, { uuid: userUuid }), {
        method: 'POST',
        body: input,
      });
      return response.user;
    },
    async setPassword(userUuid: string, input: StaffPasswordUpdateRequest) {
      const response = await client.requestJson<StaffPasswordUpdatePayload>(apiPath(API_PATHS.postStaffPasswordUuid, { uuid: userUuid }), {
        method: 'POST',
        body: input,
      });
      return response.user;
    },
    punishments: {
      async list() {
        const response = await client.requestJson<StaffPunishmentsPayload>(apiPath(API_PATHS.getStaffPunishments));
        return response.punishments;
      },
      async issue(input: { username?: string; userUuid?: string; reason: string; durationMinutes?: number }) {
        const response = await client.requestJson<{ punishment: Punishment }>(apiPath(API_PATHS.postStaffPunishments), {
          method: 'POST',
          body: input,
        });
        return response.punishment;
      },
      async lift(punishmentId: string) {
        const response = await client.requestJson<{ punishment: Punishment }>(apiPath(API_PATHS.postStaffPunishmentsIdLift, { id: punishmentId }), {
          method: 'POST',
        });
        return response.punishment;
      },
    },
    appeals: {
    async list() {
      const response = await client.requestJson<{ appeals: Appeal[] }>(apiPath(API_PATHS.getStaffAppeals));
      return response.appeals;
    },
    async resolve(appealId: string, decision: 'lift' | 'deny') {
      await client.requestJson(apiPath(API_PATHS.postStaffAppealsIdResolve, { id: appealId }), {
        method: 'POST',
        body: { decision },
      });
    },
  },
  users: {
    async teams(userUuid: string) {
      const response = await client.requestJson<{ teams: { team: import('@common').Team; role: string }[] }>(apiPath(API_PATHS.getStaffUsersUuidTeams, { uuid: userUuid }));
      return response.teams;
    },
    async credits(userUuid: string) {
      const response = await client.requestJson<{ credits: import('@common').CreditBalance }>(apiPath(API_PATHS.getStaffUsersUuidCredits, { uuid: userUuid }));
      return response.credits;
    },
    async devices(userUuid: string) {
      const response = await client.requestJson<{ devices: import('@common').DeviceSummary[] }>(apiPath(API_PATHS.getStaffUsersUuidDevices, { uuid: userUuid }));
      return response.devices;
    },
    async locations(userUuid: string) {
      const response = await client.requestJson<{ locations: import('@common').Location[] }>(apiPath(API_PATHS.getStaffUsersUuidLocations, { uuid: userUuid }));
      return response.locations;
    },
  },
  teams: {
    async update(teamId: string, input: { tier?: string; seats?: number; gifted?: boolean }) {
      const response = await client.requestJson<{ team: import('@common').Team }>(apiPath(API_PATHS.patchStaffTeamsId, { id: teamId }), {
        method: 'PATCH',
        body: input,
      });
      return response.team;
    },
    async delete(teamId: string) {
      await client.requestJson(apiPath(API_PATHS.deleteStaffTeamsId, { id: teamId }), { method: 'DELETE' });
    },
    async updateMemberRole(teamId: string, userUuid: string, role: string) {
      await client.requestJson(apiPath(API_PATHS.patchStaffTeamsIdMembersUuidRole, { id: teamId, uuid: userUuid }), {
        method: 'PATCH',
        body: { role },
      });
    },
    async removeMember(teamId: string, userUuid: string) {
      await client.requestJson(apiPath(API_PATHS.deleteStaffTeamsIdMembersUuid, { id: teamId, uuid: userUuid }), { method: 'DELETE' });
    },
  },
};
}
