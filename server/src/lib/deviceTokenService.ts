import type { DeviceUploadToken } from '@common';

export type PresentedDeviceToken = Omit<DeviceUploadToken, 'tokenHash'> & {
  lastUsed?: Date;
  lastActive?: Date;
  isActive: boolean;
  status: 'active' | 'inactive';
};

export function toPresentedDeviceToken(token: DeviceUploadToken): PresentedDeviceToken {
  const { tokenHash, ...rest } = token;
  void tokenHash;
  return {
    ...rest,
    lastUsed: rest.lastUsedAt,
    lastActive: rest.lastUsedAt,
    isActive: rest.active,
    status: rest.active ? 'active' : 'inactive',
  };
}

export function toPresentedDeviceTokens(tokens: DeviceUploadToken[]): PresentedDeviceToken[] {
  return tokens.map(toPresentedDeviceToken);
}
