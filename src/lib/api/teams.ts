import type {
  Team,
  TeamMember,
  TeamMemberAddRequest,
  TeamMemberRoleUpdateRequest,
  TeamPayload,
  TeamAuditLogListPayload,
  TeamAuditLogListQuery,
  TeamSubscriptionPayload,
  SubscriptionTier,
  BillingInterval,
} from '@common';
import type { RequestClient } from './client';
import { API_PATHS, apiPath } from './generated/routes';

export function createTeamsApi(client: RequestClient) {
  return {
    async me() {
      const response = await client.requestJson<TeamPayload>(apiPath(API_PATHS.getTeam));
      return response;
    },
    async updateTeam(input: { name: string }) {
      const response = await client.requestJson<{ team: Team }>(apiPath(API_PATHS.patchTeam), {
        method: 'PATCH',
        body: input,
      });
      return response.team;
    },
    async listMembers() {
      const response = await client.requestJson<{ members: TeamMember[] }>(apiPath(API_PATHS.getTeamMembers));
      return response.members;
    },
    async addMember(input: TeamMemberAddRequest) {
      const response = await client.requestJson<{ member: TeamMember }>(apiPath(API_PATHS.postTeamMembers), {
        method: 'POST',
        body: input,
      });
      return response.member;
    },
    async updateRole(uuid: string, input: TeamMemberRoleUpdateRequest) {
      const response = await client.requestJson<{ member: TeamMember }>(apiPath(API_PATHS.patchTeamMembersUuidRole, { uuid: uuid }), {
        method: 'PATCH',
        body: input,
      });
      return response.member;
    },
    async removeMember(uuid: string) {
      await client.requestJson(apiPath(API_PATHS.deleteTeamMembersUuid, { uuid: uuid }), {
        method: 'DELETE',
      });
    },
    async deleteTeam() {
      await client.requestJson(apiPath(API_PATHS.deleteTeams), { method: 'DELETE' });
    },
    async listInvites() {
      const response = await client.requestJson<{ invites: import('@common').TeamInvite[] }>(apiPath(API_PATHS.getTeamInvites));
      return response.invites;
    },
    async revokeInvite(id: string) {
      await client.requestJson(apiPath(API_PATHS.deleteTeamInvitesId, { id: id }), { method: 'DELETE' });
    },
    async listMine() {
      const response = await client.requestJson<{ teams: Team[] }>(apiPath(API_PATHS.getTeamsMine));
      return response.teams;
    },
    async switchTeam(teamId: string) {
      await client.requestJson(apiPath(API_PATHS.postTeamsSwitch), { method: 'POST', body: { teamId } });
    },
    async createTeam(name?: string) {
      const response = await client.requestJson<{ team: Team }>(apiPath(API_PATHS.postTeamsCreate), {
        method: 'POST',
        body: { name },
      });
      return response.team;
    },
    async subscription() {
      const response = await client.requestJson<TeamSubscriptionPayload>(apiPath(API_PATHS.getTeamSubscription));
      return response;
    },
    async subscriptionCheckout(tier: SubscriptionTier, interval: BillingInterval) {
      const response = await client.requestJson<{ url: string }>(apiPath(API_PATHS.postTeamSubscriptionCheckout), {
        method: 'POST',
        body: { tier, interval },
      });
      return response.url;
    },
    async subscriptionPortal() {
      const response = await client.requestJson<{ url: string }>(apiPath(API_PATHS.postTeamSubscriptionPortal), {
        method: 'POST',
      });
      return response.url;
    },
    async setFreePlan() {
      const response = await client.requestJson<{ team: Team }>(apiPath(API_PATHS.postTeamSubscriptionFree), { method: 'POST' });
      return response.team;
    },
    async pendingInvites() {
      const response = await client.requestJson<{ invites: import('@common').TeamInvite[] }>(apiPath(API_PATHS.getTeamInvitesPending));
      return response.invites;
    },
    async acceptInvite(token: string) {
      await client.requestJson(apiPath(API_PATHS.postTeamInvitesAccept), { method: 'POST', body: { token } });
    },
    async auditLogs(query: TeamAuditLogListQuery = {}) {
      const params = new URLSearchParams();
      if (query.page) params.set('page', String(query.page));
      if (query.pageSize) params.set('pageSize', String(query.pageSize));
      const search = params.toString();
      return client.requestJson<TeamAuditLogListPayload>(
        apiPath(API_PATHS.getTeamAudit, {}, search ? `?${search}` : ''),
      );
    },
  };
}
