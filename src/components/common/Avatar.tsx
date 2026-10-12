import './Avatar.css';
import { API_BASE_URL } from '../../lib/api';

export interface AvatarProps {
  username: string;
  avatarUrl?: string;
  size?: number;
  className?: string;
}

function resolveAvatarUrl(avatarUrl: string): string {
  return /^https?:\/\//i.test(avatarUrl) ? avatarUrl : `${API_BASE_URL}${avatarUrl}`;
}

export const Avatar = ({ username, avatarUrl, size = 28, className = '' }: AvatarProps) => {
  const style = { width: size, height: size };

  if (avatarUrl) {
    return (
      <img
        className={`avatar ${className}`}
        style={style}
        src={resolveAvatarUrl(avatarUrl)}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    );
  }

  const initial = username.trim().charAt(0).toUpperCase() || '?';

  return (
    <span
      className={`avatar avatar--fallback ${className}`}
      style={{ ...style, fontSize: Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
};