import type { Device } from './device';
import type { Punishment } from './punishment';
import type { PublicUser, UserRole } from './user';

export type AuthSession = {
  user: PublicUser;
  token: string;
};

export type AuthMeResponse = {
  user: PublicUser;
  suspension: Punishment | null;
};

export type UserMeResponse = {
  user: PublicUser;
  activeSuspension: Punishment | null;
};

export type ProfileMeResponse = {
  user: PublicUser;
};

export type CountryOption = {
  code: string;
  name: string;
};

export type ProfileCountriesResponse = {
  countries: CountryOption[];
};

export type PunishmentsMeResponse = {
  user: PublicUser;
  activeSuspension: Punishment | null;
  punishments: Punishment[];
};

export type StaffSummary = {
  userCount: number;
  staffCount: number;
  ownerCount: number;
};

export type PurchaseRequest = {
  center: { lat: number; lon: number };
  radiusMeters?: number;
  start: Date;
  end: Date;
  limit?: number;
};

export type MarketPurchaseResponse = {
  total: number;
  returned: number;
  records: Array<Record<string, unknown>>;
};

export type ApiErrorBody = {
  error?: string;
  message?: string;
  suspension?: Punishment;
};

export type AuthResponsePayload = {
  user: PublicUser;
  token: string;
};

export type AuthMePayload = {
  user: PublicUser;
  suspension: Punishment | null;
};

export type UserMePayload = {
  user: PublicUser;
  activeSuspension: Punishment | null;
};

export type ProfileMePayload = {
  user: PublicUser;
};

export type ProfileCountriesPayload = {
  countries: CountryOption[];
};

export type PunishmentsMePayload = {
  user: PublicUser;
  activeSuspension: Punishment | null;
  punishments: Punishment[];
};

export type DeviceListPayload = {
  devices: Device[];
};

export type DevicePayload = {
  device: Device;
};

export type PunishmentPayload = {
  punishment: Punishment;
};

export type StaffUsersPayload = {
  users: PublicUser[];
};

export type StaffPunishmentsPayload = {
  punishments: Punishment[];
};

export type StaffRoleUpdatePayload = {
  user: PublicUser;
};

export type StaffRoleUpdateRequest = {
  role: UserRole;
};
