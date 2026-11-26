import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { queryKeys } from '../keys';

export function useTeamsMine() {
  return useQuery({ queryKey: queryKeys.teams('mine'), queryFn: () => api.teams.listMine() });
}

export function useTeamMe() {
  return useQuery({ queryKey: queryKeys.teams('me'), queryFn: () => api.teams.me() });
}

export function useTeamMembers(teamId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.teams('members', teamId),
    queryFn: () => api.teams.listMembers(),
    enabled: !!teamId,
  });
}
