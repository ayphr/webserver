import type {
  TeamMember,
  TeamMemberAddRequest,
  TeamMemberRoleUpdateRequest,
  TeamPayload,
  TeamAuditLogListPayload,
} from '@common';
import type { RequestClient } from './client';

export function createTeamsApi(client: RequestClient) {
  return {
    async me() {
      const response = await client.requestJson<TeamPayload>('/api/team');
      return response;
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
    async listInvites() {
      const response = await client.requestJson<{ invites: import('@common').TeamInvite[] }>('/api/team/invites');
      return response.invites;
    },
    async revokeInvite(id: string) {
      await client.requestJson(`/api/team/invites/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    async pendingInvites() {
      const response = await client.requestJson<{ invites: import('@common').TeamInvite[] }>('/api/team/invites/pending');
      return response.invites;
    },
    async acceptInvite(token: string) {
      await client.requestJson('/api/team/invites/accept', { method: 'POST', body: { token } });
    },
    async auditLogs() {
      const response = await client.requestJson<TeamAuditLogListPayload>('/api/team/audit');
      return response.logs;
    },
  };
}
