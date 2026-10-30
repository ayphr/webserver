export type Location = {
  id: string;
  ownerUuid: string;
  ownerUsername: string;
  name: string;
  isDefault?: boolean;
  createdAt: Date;
};

export type LocationSummary = Location & {
  deviceCount: number;
  onlineDeviceCount: number;
};

export type LocationCreateRequest = {
  name: string;
};

export type LocationUpdateRequest = {
  name?: string;
};