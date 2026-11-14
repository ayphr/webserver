export type NotificationType =
  | 'login'
  | 'team_invite'
  | 'team'
  | 'security'
  | 'punishment'
  | 'appeal'
  | 'subscription'
  | 'system';

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

export type NotificationListPayload = {
  notifications: UserNotification[];
  unreadCount: number;
};

export type NotificationUnreadCountPayload = {
  unreadCount: number;
};
