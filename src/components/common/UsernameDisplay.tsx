import './UsernameDisplay.css';
import { IconTools } from '@tabler/icons-react';
import type { PublicUser } from '../../../common';
import { countryCodeToFlag } from '../../../common';
import type { ReactNode } from 'react';
import { EmojiText } from './EmojiText';

export interface UsernameDisplayProps {
  username: string;
  role?: PublicUser['role'];
  country?: string;
  className?: string;
}

function RoleIcon({ role }: Readonly<{ role?: PublicUser['role'] }>): ReactNode | null {

  if (role === 'staff') {
    return <IconTools size={18} stroke={2} aria-label="Staff" />;
  }

  return null;
}

export const UsernameDisplay = ({
  username,
  role,
  country,
  className = '',
}: UsernameDisplayProps) => {
  const flag = countryCodeToFlag(country);

  return (
    <div className={`username-display ${className}`}>
      {role && (
        <span className="username-display__icon">
          <RoleIcon role={role} />
        </span>
      )}
      <span className="username-display__username">{username}</span>
      {flag && (
        <span className="username-display__flag">
          <EmojiText>{flag}</EmojiText>
        </span>
      )}
    </div>
  );
};
