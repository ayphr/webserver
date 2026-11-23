import type { PaginationMeta, PaginationQuery } from './pagination';

export type NotificationFilter = 'unread' | 'all';

export type NotificationType =
  | 'login'
  | 'team_invite'
  | 'team'
  | 'security'
  | 'punishment'
  | 'appeal'
  | 'subscription'
  | 'assistant_task'
  | 'system';

/** All notification types, for building preference controls and validating overrides. */
export const NOTIFICATION_TYPES = [
  'login',
  'team_invite',
  'team',
  'security',
  'punishment',
  'appeal',
  'subscription',
  'assistant_task',
  'system',
] as const satisfies readonly NotificationType[];

/**
 * Delivery settings for one account. Channels are independent switches;
 * `types` additionally mutes individual notification types across all enabled
 * channels. A missing or unset type inherits the current behavior (allowed).
 */
export type NotificationPreferences = {
  inApp: boolean;
  email: boolean;
  push: boolean;
  types: Partial<Record<NotificationType, boolean>>;
};

export type NotificationPreferencesUpdate = Partial<Omit<NotificationPreferences, 'types'>> & {
  types?: Partial<Record<NotificationType, boolean>>;
};

/** Defaults used when an account has no stored preferences document. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  inApp: true,
  email: true,
  push: true,
  types: {},
};

export type PushSubscriptionKeys = {
  p256dh: string;
  auth: string;
};

export type PushSubscriptionInput = {
  endpoint: string;
  keys: PushSubscriptionKeys;
};

export type PushPublicKeyPayload = {
  publicKey: string | null;
};

export type UserNotification = {
  id: string;
  userUuid: string;
  type: NotificationType;
  title: string;
  message: string;
  /** Dashboard link to open when the notification is selected. */
  link?: string;
  read: boolean;
  createdAt: Date;
  readAt?: Date;
};

export type NotificationListQuery = PaginationQuery & {
  filter?: NotificationFilter;
};

export type NotificationListPayload = {
  notifications: UserNotification[];
  unreadCount: number;
} & PaginationMeta;

export type NotificationUnreadCountPayload = {
  unreadCount: number;
};
