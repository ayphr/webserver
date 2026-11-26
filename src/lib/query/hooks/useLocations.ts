import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { queryKeys } from '../keys';

export function useLocationsMine() {
  return useQuery({
    queryKey: queryKeys.locationsMine(),
    queryFn: () => api.locations.listMine(),
  });
}
