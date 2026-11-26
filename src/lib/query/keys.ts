export const queryKeys = {
  bootstrap: () => ['bootstrap'] as const,
  devicesMine: () => ['devices', 'mine'] as const,
  device: (serial: number) => ['device', serial] as const,
  deviceDataPoints: (serial: number, params: unknown) => ['deviceDataPoints', serial, params] as const,
  locationsMine: () => ['locations', 'mine'] as const,
  location: (id: string) => ['location', id] as const,
  locationDataPoints: (id: string, params: unknown) => ['locationDataPoints', id, params] as const,
  assistantState: () => ['assistant', 'state'] as const,
  notificationsUnread: () => ['notifications', 'unread'] as const,
  notifications: (params: unknown) => ['notifications', params] as const,
  creditsMe: () => ['credits', 'me'] as const,
  teams: (scope: string, params?: unknown) => ['teams', scope, params] as const,
};
