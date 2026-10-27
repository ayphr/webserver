import React from 'react';
import './Sidebar.css';
import logo from '../../assets/logo.svg';
import { IconGauge, IconSettings, IconUser, IconDatabase, IconPlaceholder, IconBan, IconCreditCard, IconUsers, IconApps, IconPlugConnected } from '@tabler/icons-react';
import { UsernameDisplay } from '../common';
import type { BadgeId } from '@common/types';

type Tab = { id: string; name: string };

const tabs: Tab[] = [
  { id: 'overview', name: 'Overview' },
  { id: 'devices', name: 'Devices' },
];

const staffTabs: Tab[] = [
  { id: 'users', name: 'Users' },
];

const developerTabs: Tab[] = [
  { id: 'my-apps', name: 'My Apps' },
];

const iconFor = (id: string) => {
  switch (id) {
    case 'overview':
      return <IconGauge size={18} />;
    case 'devices':
      return <IconDatabase size={18} />;
    case 'users':
      return <IconUsers size={18} />;
    case 'my-apps':
      return <IconApps size={18} />;
    case 'jail':
      return <IconBan size={18} />;
    default:
      return <IconPlaceholder size={18} />;
  }
};

type Props = {
  activeTab: string;
  onChange: (id: string) => void;
  username?: string;
  badges?: BadgeId[];
  country?: string | null;
  avatarUrl?: string;
  isSuspended?: boolean;
  isStaff?: boolean;
  isDeveloper?: boolean;
};

export const Sidebar: React.FC<Props> = ({ activeTab, onChange, username = 'unknown', badges = [], country, avatarUrl, isSuspended = false, isStaff = false, isDeveloper = false }) => {
  const visibleTabs = [
    ...tabs,
    ...(isDeveloper ? developerTabs : []),
    ...(isStaff ? staffTabs : []),
  ];

  return (
    <aside className="n-sidebar" aria-label="Sidebar">
      <div className="n-sidebar__top">
        <img src={logo} alt="Ayphr" className="n-sidebar__logo" />
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
          visibleTabs.map((t) => (
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
            className={`n-sidebar__menuItem ${activeTab === 'connections' ? 'active' : ''}`}
            type="button"
            onClick={() => onChange('connections')}
          >
            <span className="n-sidebar__menuIcon"><IconPlugConnected size={16} strokeWidth={1.5} /></span>
            <span>Connections</span>
          </button>
          <button
            className={`n-sidebar__menuItem ${activeTab === 'account-settings' ? 'active' : ''}`}
            type="button"
            onClick={() => onChange('account-settings')}
          >
            <span className="n-sidebar__menuIcon"><IconSettings size={16} strokeWidth={1.5} /></span>
            <span>Settings</span>
          </button>
          <button
            className={`n-sidebar__menuItem ${activeTab === 'subscription' ? 'active' : ''}`}
            type="button"
            onClick={() => onChange('subscription')}
          >
            <span className="n-sidebar__menuIcon"><IconCreditCard size={16} strokeWidth={1.5} /></span>
            <span>Subscription</span>
          </button>
        </nav>

        <div className="n-sidebar__accountDisplay">
          <UsernameDisplay username={username} badges={badges} country={country ?? undefined} avatarUrl={avatarUrl} />
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
