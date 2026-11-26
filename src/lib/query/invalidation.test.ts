import { describe, expect, test } from 'bun:test';
import { queryKeys } from './keys';
import { keysToInvalidateForMutation } from './invalidation';

describe('keysToInvalidateForMutation', () => {
  test('device mutation invalidates devices and bootstrap', () => {
    expect(keysToInvalidateForMutation('device.change')).toEqual([queryKeys.devicesMine(), queryKeys.bootstrap()]);
  });

  test('location mutation invalidates locations and devices', () => {
    expect(keysToInvalidateForMutation('location.change')).toEqual([queryKeys.locationsMine(), queryKeys.devicesMine()]);
  });
});
