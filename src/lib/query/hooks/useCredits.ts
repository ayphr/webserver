import { useQuery } from '@tanstack/react-query';
import type { CreditBalance } from '@common';
import { api } from '../../api';
import { queryKeys } from '../keys';

export function useCreditsMe(initialData?: CreditBalance | null) {
  return useQuery({
    queryKey: queryKeys.creditsMe(),
    queryFn: () => api.credits.me(),
    initialData: initialData ?? undefined,
  });
}
