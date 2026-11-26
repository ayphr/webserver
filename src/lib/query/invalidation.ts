import { queryKeys } from './keys';

export type MutationKind = 'device.change' | 'location.change' | 'assistant.change' | 'team.change' | 'credits.change' | 'notification.change';

export function keysToInvalidateForMutation(kind: MutationKind): readonly (readonly unknown[])[] {
  switch (kind) {
    case 'device.change':
      return [queryKeys.devicesMine(), queryKeys.bootstrap()];
    case 'location.change':
      return [queryKeys.locationsMine(), queryKeys.devicesMine()];
    case 'assistant.change':
      return [queryKeys.assistantState()];
    case 'team.change':
      return [['teams'] as const, queryKeys.bootstrap()];
    case 'credits.change':
      return [queryKeys.creditsMe(), queryKeys.bootstrap()];
    case 'notification.change':
      return [['notifications'] as const];
    default:
      return [];
  }
}
