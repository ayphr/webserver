import { IconSparkle, IconSparkle2, IconSparkles2, IconSparkles, IconTool } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { BADGES, type BadgeId, type IconId } from '@common';

export const ICONS: Record<IconId, ReactNode> = {
  plus: <IconSparkle size={18} />,
  star: <IconSparkle2 size={18} />,
  stars: <IconSparkles2 size={18} />,
  '3-stars': <IconSparkles size={18} />,
  staff: <IconTool size={18} />,
};

export function getBadgeIcon(badgeId: BadgeId): ReactNode {
  const iconId = BADGES.find((badge) => badge.id === badgeId)?.iconId;
  return iconId ? ICONS[iconId] : null;
}
