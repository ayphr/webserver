import { queryOptions, type QueryClient } from '@tanstack/react-query';
import type { UserMePayload } from '@common';
import { api as defaultApi } from '../api';
import { queryKeys } from './keys';

type ApiLike = { users: { me: () => Promise<UserMePayload> } };

export function bootstrapQueryOptions(api: ApiLike = defaultApi) {
  return queryOptions({
    queryKey: queryKeys.bootstrap(),
    queryFn: () => api.users.me(),
    staleTime: 30_000,
  });
}

export async function invalidateBootstrap(queryClient: QueryClient) {
  await queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap() });
}
