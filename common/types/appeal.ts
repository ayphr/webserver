export type AppealStatus = 'pending' | 'accepted' | 'denied';

export type Appeal = {
  id: string;
  punishmentId: string;
  userUuid: string;
  userUsername: string;
  text: string;
  createdAt: Date;
  status: AppealStatus;
  resolvedAt?: Date;
  resolvedByUuid?: string;
  resolvedByUsername?: string;
  resolution?: 'lifted' | 'denied';
};