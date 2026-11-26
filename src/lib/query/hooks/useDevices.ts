import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { queryKeys } from '../keys';

export function useDevicesMine() {
  return useQuery({
    queryKey: queryKeys.devicesMine(),
    queryFn: () => api.devices.listMine(),
  });
}
