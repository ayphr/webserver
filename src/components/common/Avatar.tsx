import './Avatar.css';
import { API_BASE_URL } from '../../lib/api';
import { API_VERSION } from '../../lib/api/generated/routes';

export interface AvatarProps {
  username: string;
  avatarUrl?: string;
  size?: number;
  className?: string;
}

/** Stored accounts can still hold avatar URLs from before the API was versioned. */
function withApiVersion(url: string): string {
  return url.replace(/^\/api\/(?!v\d+\/)/, `/api/${API_VERSION}/`);
}

function resolveAvatarUrl(avatarUrl: string): string {
  const normalized = withApiVersion(avatarUrl);
  return /^https?:\/\//i.test(normalized) ? normalized : `${API_BASE_URL}${normalized}`;
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