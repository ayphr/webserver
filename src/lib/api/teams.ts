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

export function createTeamsApi(client: RequestClient) {
  return {
    async me() {
      const response = await client.requestJson<TeamPayload>('/api/team');
      return response;
    },
    async updateTeam(input: { name: string }) {
      const response = await client.requestJson<{ team: Team }>('/api/team', {
        method: 'PATCH',
        body: input,
      });
      return response.team;
    },
    async listMembers() {
      const response = await client.requestJson<{ members: TeamMember[] }>('/api/team/members');
      return response.members;
    },
    async addMember(input: TeamMemberAddRequest) {
      const response = await client.requestJson<{ member: TeamMember }>('/api/team/members', {
        method: 'POST',
        body: input,
      });
      return response.member;
    },
    async updateRole(uuid: string, input: TeamMemberRoleUpdateRequest) {
      const response = await client.requestJson<{ member: TeamMember }>(`/api/team/members/${encodeURIComponent(uuid)}/role`, {
        method: 'PATCH',
        body: input,
      });
      return response.member;
    },
    async removeMember(uuid: string) {
      await client.requestJson(`/api/team/members/${encodeURIComponent(uuid)}`, {
        method: 'DELETE',
      });
    },
    async deleteTeam() {
      await client.requestJson('/api/teams', { method: 'DELETE' });
    },
    async listInvites() {
      const response = await client.requestJson<{ invites: import('@common').TeamInvite[] }>('/api/team/invites');
      return response.invites;
    },
    async revokeInvite(id: string) {
      await client.requestJson(`/api/team/invites/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    async listMine() {
      const response = await client.requestJson<{ teams: Team[] }>('/api/teams/mine');
      return response.teams;
    },
    async switchTeam(teamId: string) {
      await client.requestJson('/api/teams/switch', { method: 'POST', body: { teamId } });
    },
    async createTeam(name?: string) {
      const response = await client.requestJson<{ team: Team }>('/api/teams/create', {
        method: 'POST',
        body: { name },
      });
      return response.team;
    },
    async subscription() {
      const response = await client.requestJson<TeamSubscriptionPayload>('/api/team/subscription');
      return response;
    },
    async subscriptionCheckout(tier: SubscriptionTier, interval: BillingInterval) {
      const response = await client.requestJson<{ url: string }>('/api/team/subscription/checkout', {
        method: 'POST',
        body: { tier, interval },
      });
      return response.url;
    },
    async subscriptionPortal() {
      const response = await client.requestJson<{ url: string }>('/api/team/subscription/portal', {
        method: 'POST',
      });
      return response.url;
    },
    async setFreePlan() {
      const response = await client.requestJson<{ team: Team }>('/api/team/subscription/free', { method: 'POST' });
      return response.team;
    },
    async pendingInvites() {
      const response = await client.requestJson<{ invites: import('@common').TeamInvite[] }>('/api/team/invites/pending');
      return response.invites;
    },
    async acceptInvite(token: string) {
      await client.requestJson('/api/team/invites/accept', { method: 'POST', body: { token } });
    },
    async auditLogs(query: TeamAuditLogListQuery = {}) {
      const params = new URLSearchParams();
      if (query.page) params.set('page', String(query.page));
      if (query.pageSize) params.set('pageSize', String(query.pageSize));
      const search = params.toString();
      return client.requestJson<TeamAuditLogListPayload>(
        `/api/team/audit${search ? `?${search}` : ''}`,
      );
    },
  };
}
