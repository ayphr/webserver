import React from 'react';
import './Sidebar.css';
import { IconGauge, IconSettings, IconUser, IconDatabase, IconPlaceholder, IconTable, IconCoin, IconBan } from '@tabler/icons-react';
import { UsernameDisplay } from '../common';
import type { UserRole } from '../../../common/types/user';

type Tab = { id: string; name: string };

const tabs: Tab[] = [
  { id: 'overview', name: 'Overview' },
  { id: 'devices', name: 'Devices' },
  { id: 'data', name: 'Data' },
  { id: 'credits', name: 'Credits' },
];

const iconFor = (id: string) => {
  switch (id) {
    case 'overview':
      return <IconGauge size={18} />;
    case 'devices':
      return <IconDatabase size={18} />;
    case 'data':
      return <IconTable size={18} />;
    case 'credits':
      return <IconCoin size={18} />;
    case 'jail':
      return <IconBan
        size={18} />;
    default:
      return <IconPlaceholder size={18} />;
  }
};

type Props = {
  activeTab: string;
  onChange: (id: string) => void;
  username?: string;
  role?: UserRole;
  country?: string | null;
  isSuspended?: boolean;
};

export const Sidebar: React.FC<Props> = ({ activeTab, onChange, username = 'unknown', role, country, isSuspended = false }) => {
  return (
    <aside className="n-sidebar" aria-label="Sidebar">
      <div className="n-sidebar__top">
        <h1 className="n-sidebar__title">Ayphr</h1>
      </div>

      <nav className="n-sidebar__tabs" aria-label="Primary">
        {isSuspended ? (
          <button
            className={`n-sidebar__tab active`}
            type="button"
            onClick={() => onChange('overview')}
          >
            <span className="n-sidebar__icon">{iconFor('jail')}</span>
            <span className="n-sidebar__label">Jail</span>
          </button>
        ) : (
          tabs.map((t) => (
            <button
              key={t.id}
              className={`n-sidebar__tab ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => onChange(t.id)}
              type="button"
            >
              <span className="n-sidebar__icon">{iconFor(t.id)}</span>
              <span className="n-sidebar__label">{t.name}</span>
            </button>
          ))
        )}
      </nav>

      <div className="n-sidebar__spacer" />

      <div className="n-sidebar__bottom">
        <nav className="n-sidebar__bottomTabs" aria-label="Account tabs">
          <button
            className={`n-sidebar__menuItem ${activeTab === 'profile' ? 'active' : ''}`}
            type="button"
            onClick={() => onChange('profile')}
          >
            <span className="n-sidebar__menuIcon"><IconUser size={16} strokeWidth={1.5} /></span>
            <span>Profile</span>
          </button>
          <button
            className={`n-sidebar__menuItem ${activeTab === 'account-settings' ? 'active' : ''}`}
            type="button"
            onClick={() => onChange('account-settings')}
          >
            <span className="n-sidebar__menuIcon"><IconSettings size={16} strokeWidth={1.5} /></span>
            <span>Settings</span>
          </button>
        </nav>

        <div className="n-sidebar__accountDisplay">
          <UsernameDisplay username={username} role={role ?? 'user'} country={country ?? undefined} />
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
