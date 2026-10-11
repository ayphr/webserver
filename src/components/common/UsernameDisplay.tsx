import './UsernameDisplay.css';
import type { BadgeId } from '../../../common';
import { BADGES } from '../../../common';
import { countryCodeToFlag } from '../../../common';
import { EmojiText } from './EmojiText';
import { getBadgeIcon } from '../../lib/badges';

export interface UsernameDisplayProps {
  username: string;
  badges?: BadgeId[];
  country?: string;
  className?: string;
}

export const UsernameDisplay = ({
  username,
  badges = [],
  country,
  className = '',
}: UsernameDisplayProps) => {
  const flag = countryCodeToFlag(country);

  return (
    <div className={`username-display ${className}`}>
      <span className="username-display__username">{username}</span>
      {badges.length > 0 && (
        <span className="username-display__icons">
          {badges.map((badgeId) => {
            const name = BADGES.find((badge) => badge.id === badgeId)?.name ?? badgeId;
            return (
              <span key={badgeId} className="username-display__icon" aria-label={name} title={name}>
                {getBadgeIcon(badgeId)}
              </span>
            );
          })}
        </span>
      )}
      {flag && (
        <span className="username-display__flag">
          <EmojiText>{flag}</EmojiText>
        </span>
      )}
    </div>
  );
};
