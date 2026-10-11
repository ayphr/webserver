import './UsernameDisplay.css';
import type { BadgeId } from '../../../common';
import { BADGES, countryCodeToFlag } from '../../../common';
import { EmojiText } from './EmojiText';
import { getBadgeIcon } from '../../lib/badges';
import { Tooltip } from './Tooltip';

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
              <Tooltip key={badgeId} content={name}>
                <span className="username-display__icon" aria-label={name}>
                  {getBadgeIcon(badgeId)}
                </span>
              </Tooltip>
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
