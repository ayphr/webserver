export type Badge = {
  id: BadgeId;
  name: string;
  iconId: IconId;
};

export type IconId = 'plus' | 'star' | 'stars' | '3-stars' | 'staff';

export type BadgeId =
  | 'lite'
  | 'plus'
  | 'ultra'
  | 'team-lite'
  | 'team-plus'
  | 'team-ultra'
  | 'staff';

export const BADGES: Badge[] = [
  // Subscriptions
  {
    id: 'lite',
    name: 'Lite',
    iconId: 'plus',
  },
  {
    id: 'plus',
    name: 'Plus',
    iconId: 'star',
  },
  {
    id: 'ultra',
    name: 'Ultra',
    iconId: 'stars',
  },
  {
    id: 'team-lite',
    name: 'Team Lite',
    iconId: '3-stars',
  },
  {
    id: 'team-plus',
    name: 'Team Plus',
    iconId: '3-stars',
  },
  {
    id: 'team-ultra',
    name: 'Team Ultra',
    iconId: '3-stars',
  },

  // Roles
  {
    id: 'staff',
    name: 'Staff',
    iconId: 'staff',
  },
];
