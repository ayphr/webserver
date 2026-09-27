export type Device = {
  serial: number;
  ownerUuid: string;
  ownerUsername: string;
  registeredAt: Date;
  lastBroadcastedAt?: Date;
  metadata?: Record<string, unknown>;
};
