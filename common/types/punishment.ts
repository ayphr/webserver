export type PunishmentType = 'suspension';

export type Punishment = {
  id: string;
  type: PunishmentType;
  userUuid: string;
  userUsername: string;
  reason: string;
  issuedByUuid: string;
  issuedByUsername: string;
  issuedAt: Date;
  startsAt: Date;
  endsAt: Date | null;
  liftedAt?: Date;
  liftedByUuid?: string;
  liftedByUsername?: string;
  liftedReason?: string;
};
