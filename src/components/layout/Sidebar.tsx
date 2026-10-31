import React, { useEffect, useRef, useState } from 'react';
import './Sidebar.css';
import logo from '../../assets/logo.svg';
import { IconGauge, IconSettings, IconUser, IconDatabase, IconMapPin, IconPlaceholder, IconBan, IconCreditCard, IconUsers, IconApps, IconPlugConnected, IconLogout, IconRobot } from '@tabler/icons-react';
import { UsernameDisplay } from '../common';
import { ConfirmDialog } from '../common/Dialog';
import type { StoredAccount } from '../../lib/accounts';
import type { BadgeId } from '@common/types';

type Tab = { id: string; name: string };

const tabs: Tab[] = [
  { id: 'overview', name: 'Overview' },
  { id: 'assistant', name: 'Assistant' },
  { id: 'devices', name: 'Devices' },
  { id: 'locations', name: 'Locations' },
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
    case 'locations':
      return <IconMapPin size={18} />;
    case 'users':
      return <IconUsers size={18} />;
    case 'my-apps':
      return <IconApps size={18} />;
    case 'assistant':
      return <IconRobot size={18} />;
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
  accounts?: StoredAccount[];
  activeToken?: string | null;
  onSwitchAccount?: (token: string) => void;
  onLogoutAccount?: (token: string) => void;
};

export const Sidebar: React.FC<Props> = ({
  activeTab,
  onChange,
  username = 'unknown',
  badges = [],
  country,
  avatarUrl,
  isSuspended = false,
  isStaff = false,
  isDeveloper = false,
  accounts = [],
  activeToken = null,
  onSwitchAccount,
  onLogoutAccount,
}) => {
  const visibleTabs = [
    ...tabs,
    ...(isDeveloper ? developerTabs : []),
    ...(isStaff ? staffTabs : []),
  ];

  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [accountToLogout, setAccountToLogout] = useState<StoredAccount | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isAccountMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsAccountMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isAccountMenuOpen]);

  const handleConfirmLogout = () => {
    const account = accountToLogout;
    setAccountToLogout(null);
    if (account) {
      onLogoutAccount?.(account.token);
    }
  };

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
            className={`n-sidebar__menuItem ${activeTab === 'account-settings' || activeTab === 'settings' ? 'active' : ''}`}
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

        <div className="n-sidebar__accountDisplay n-sidebar__accountDisplay--clickable" ref={containerRef}>
          <button
            type="button"
            className="n-sidebar__accountButton"
            onClick={() => setIsAccountMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={isAccountMenuOpen}
          >
            <UsernameDisplay username={username} badges={badges} country={country ?? undefined} avatarUrl={avatarUrl} />
          </button>

          {isAccountMenuOpen && (
            <div className="n-sidebar__accountMenu" role="menu">
              {accounts.filter((account) => account.token !== activeToken).length === 0 && (
                <div className="n-sidebar__accountMenuItem n-sidebar__accountMenuItem--empty">
                  No other signed-in accounts
                </div>
              )}
              {accounts
                .filter((account) => account.token !== activeToken)
                .map((account) => (
                <div key={account.user.uuid} className="n-sidebar__accountMenuItem">
                  <button
                    type="button"
                    className="n-sidebar__accountSwitch"
                    onClick={() => {
                      onSwitchAccount?.(account.token);
                      setIsAccountMenuOpen(false);
                    }}
                  >
                    <span className="n-sidebar__accountName">{account.user.username}</span>
                  </button>
                  <button
                    type="button"
                    className="n-sidebar__accountLogout"
                    aria-label={`Sign out ${account.user.username}`}
                    onClick={() => setAccountToLogout(account)}
                  >
                    <IconLogout size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={accountToLogout !== null}
        title="Sign out account"
        confirmText="Sign out"
        cancelText="Cancel"
        isDangerous
        onConfirm={handleConfirmLogout}
        onCancel={() => setAccountToLogout(null)}
      >
        {accountToLogout && (
          <p>
            Sign out <strong>{accountToLogout.user.username}</strong>? That account will need to log in again.
          </p>
        )}
      </ConfirmDialog>
    </aside>
  );
};

export default Sidebar;
