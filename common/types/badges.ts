export type Badge = {
  id: BadgeId;
  name: string;
  iconId: IconId;
};

export type IconId = 'plus' | 'star' | 'filled-star' | 'staff';

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
    iconId: 'filled-star',
  },
  {
    id: 'team-lite',
    name: 'Team Lite',
    iconId: 'plus',
  },
  {
    id: 'team-plus',
    name: 'Team Plus',
    iconId: 'star',
  },
  {
    id: 'team-ultra',
    name: 'Team Ultra',
    iconId: 'filled-star',
  },

  // Roles
  {
    id: 'staff',
    name: 'Staff',
    iconId: 'staff',
  },
];
