import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { IconAdjustmentsHorizontal, IconLayoutDashboard, IconLock, IconLogout, IconLogout2, IconShieldLock, IconTrash, IconApps } from '@tabler/icons-react';
import { api } from '../../lib/api';
import { getStoredAccounts, removeStoredAccount, setActiveToken, updateStoredAccount, type StoredAccount } from '../../lib/accounts';
import type { Punishment, PublicUser, CreditBalance } from '@common';
import type { SettingsSection } from '../../lib/settings';
import { Card, CardBody, CardHeader, UsernameDisplay, ProfileCard, Button } from '../../components/common';
import { Sidebar } from '../../components/layout';
import { SessionsModal, ChangePasswordModal } from '../../components/settings';
import { SettingsPanel } from '../../components/settings';

const DevicesPanel = lazy(() => import('../../components/devices').then((m) => ({ default: m.DevicesPanel })));
const LocationsPanel = lazy(() => import('../../components/locations').then((m) => ({ default: m.LocationsPanel })));
const MyAppsPanel = lazy(() => import('../../components/developer/MyAppsPanel').then((m) => ({ default: m.MyAppsPanel })));
const ConnectionsPanel = lazy(() => import('../../components/connections/ConnectionsPanel').then((m) => ({ default: m.ConnectionsPanel })));
const SubscriptionPanel = lazy(() => import('../../components/subscriptions/SubscriptionPanel').then((m) => ({ default: m.SubscriptionPanel })));
const CreditsPanel = lazy(() => import('../../components/credits').then((m) => ({ default: m.CreditsPanel })));
const UsersPanel = lazy(() => import('../../components/staff').then((m) => ({ default: m.UsersPanel })));
const GamesPanel = lazy(() => import('../../components/games/GamesPanel').then((m) => ({ default: m.GamesPanel })));
import './DashboardPage.css';

const VALID_TABS = new Set(['overview', 'devices', 'locations', 'profile', 'settings', 'account-settings', 'subscription', 'credits', 'users', 'my-apps', 'connections', 'games']);

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function getRelativeTime(date: Date | string): string {
  const resolvedDate = toDate(date);
  const now = new Date();
  const diffMs = now.getTime() - resolvedDate.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffYears > 0) return `${diffYears} year${diffYears > 1 ? 's' : ''} ago`;
  if (diffMonths > 0) return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;
  if (diffWeeks > 0) return `${diffWeeks} week${diffWeeks > 1 ? 's' : ''} ago`;
  if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffMins > 0) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  return 'just now';
}

function formatDisplayDate(date: Date | string): string {
  return toDate(date).toLocaleDateString('en-GB');
}

function getTimeRemaining(date: Date | string): string {
  const resolvedDate = toDate(date);
  const now = new Date();
  const diffMs = resolvedDate.getTime() - now.getTime();

  if (diffMs <= 0) {
    return 'Expired';
  }

  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffYears > 0) return `in ${diffYears} year${diffYears > 1 ? 's' : ''}`;
  if (diffMonths > 0) return `in ${diffMonths} month${diffMonths > 1 ? 's' : ''}`;
  if (diffWeeks > 0) return `in ${diffWeeks} week${diffWeeks > 1 ? 's' : ''}`;
  if (diffDays > 0) return `in ${diffDays} day${diffDays > 1 ? 's' : ''}`;
  if (diffHours > 0) return `in ${diffHours} hour${diffHours > 1 ? 's' : ''}`;
  if (diffMins > 0) return `in ${diffMins} minute${diffMins > 1 ? 's' : ''}`;
  return 'in less than a minute';
}

function PunishmentCountdown({ endsAt, isPermanent }: Readonly<{ endsAt: Date | null; isPermanent: boolean }>) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const update = () => {
      if (isPermanent) {
        setTimeLeft('Permanent');
        return;
      }

      const now = Date.now();
      const end = endsAt!.getTime();
      const diff = end - now;

      if (diff <= 0) {
        setTimeLeft('Expired');
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      if (days > 0) {
        setTimeLeft(`${days}d ${hours}h`);
      } else if (hours > 0) {
        setTimeLeft(`${hours}h ${minutes}m`);
      } else {
        setTimeLeft(`${minutes}m`);
      }
    };

    update();
    const interval = setInterval(update, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [endsAt, isPermanent]);

  return <span className="dashboard-page__countdown">{timeLeft}</span>;
}

function getStoredDefaultTab(): string {
  const stored = localStorage.getItem('ayphr-pref-default-tab');
  return stored === 'overview' || stored === 'devices' || stored === 'users' || stored === 'my-apps' ? stored : 'overview';
}

export const DashboardPage = () => {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const [activeSuspension, setActiveSuspension] = useState<Punishment | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [activePage, setActivePage] = useState<string>(() => {
    const tab = searchParams.get('tab');
    return tab && VALID_TABS.has(tab) ? tab : getStoredDefaultTab();
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isLiftingPunishment, setIsLiftingPunishment] = useState(false);
  const [isSessionsOpen, setIsSessionsOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [defaultTab, setDefaultTab] = useState<string>(getStoredDefaultTab);
  const [compactLayout, setCompactLayout] = useState<boolean>(
    () => localStorage.getItem('ayphr-pref-compact') === '1',
  );
  const [accounts, setAccounts] = useState<StoredAccount[]>(() => getStoredAccounts());

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);

      try {
        const userData = await api.users.me();
        setUser(userData.user);
        setCredits(userData.credits);
        setActiveSuspension(userData.activeSuspension);
        const token = api.getAuthToken();
        if (token) updateStoredAccount(token, userData.user);
        setAccounts(getStoredAccounts());
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load dashboard data';
        console.error(message);
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, []);

  const isSuspended = activeSuspension !== null;
  const isStaff = user?.role === 'staff';
  const isDeveloper = user?.developerAccount === true;

  const handleSelfPunishment = async () => {
    // Refresh user data to get the updated suspension status.
    try {
      const userData = await api.users.me();
      setUser(userData.user);
      setCredits(userData.credits);
      setActiveSuspension(userData.activeSuspension);
      changeTab('overview');
    } catch (err) {
      console.error('Failed to refresh user data after punishment:', err);
    }
  };

  const handleLiftSuspension = async () => {
    if (!activeSuspension) return;

    setIsLiftingPunishment(true);
    try {
      await api.staff.punishments.lift(activeSuspension.id);
      setActiveSuspension(null);
      changeTab('overview');
    } catch (err) {
      console.error('Failed to lift suspension:', err);
    } finally {
      setIsLiftingPunishment(false);
    }
  };


  const handleSwitchAccount = async (token: string) => {
    setActiveToken(token);
    try {
      const userData = await api.users.me();
      setUser(userData.user);
      setCredits(userData.credits);
      setActiveSuspension(userData.activeSuspension);
      updateStoredAccount(token, userData.user);
      setAccounts(getStoredAccounts());
    } catch {
      removeStoredAccount(token);
      setAccounts(getStoredAccounts());
      const remaining = getStoredAccounts();
      if (remaining.length > 0) {
        await handleSwitchAccount(remaining[0].token);
      } else {
        await navigate('/auth', { replace: true });
      }
    }
  };

  const handleLogoutAccount = async (token: string) => {
    const previousToken = api.getAuthToken();
    try {
      api.setAuthToken(token);
      await api.auth.logout();
    } catch {
      // Ignore failures; remove locally regardless.
    } finally {
      api.setAuthToken(previousToken);
    }
    removeStoredAccount(token);
    setAccounts(getStoredAccounts());
    if (token === previousToken) {
      const remaining = getStoredAccounts();
      if (remaining.length > 0) {
        await handleSwitchAccount(remaining[0].token);
      } else {
        await navigate('/auth', { replace: true });
      }
    }
  };

  const navigate = useNavigate();

  const changeTab = (value: string) => {
    setActivePage(value);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', value);
      return next;
    }, { replace: true });
  };

  useEffect(() => {
    if (!isLoading && user && activePage === 'users' && user.role !== 'staff') {
      changeTab('overview');
    }
    if (!isLoading && user && activePage === 'my-apps' && user.developerAccount !== true) {
      changeTab('overview');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, user, activePage]);

  const setDefaultTabPref = (value: string) => {
    setDefaultTab(value);
    localStorage.setItem('ayphr-pref-default-tab', value);
  };

  const setCompactPref = (checked: boolean) => {
    setCompactLayout(checked);
    localStorage.setItem('ayphr-pref-compact', checked ? '1' : '0');
  };

  const settingsSections = useMemo<SettingsSection[]>(() => [
    {
      id: 'account',
      title: 'Account',
      options: [
        {
          id: 'logout',
          optionType: 'button',
          icon: <IconLogout size={18} strokeWidth={1.75} />,
          title: 'Log out',
          description: 'Sign out of your account on this device.',
          label: 'Log out',
          variant: 'secondary',
          action: async () => {
            await api.auth.logout();
            await navigate('/auth', { replace: true });
          },
        },
        {
          id: 'logout-other-sessions',
          optionType: 'button',
          icon: <IconLogout2 size={18} strokeWidth={1.75} />,
          title: 'Sign out all other sessions',
          description: 'Sign out of all other devices and active sessions, keeping this one.',
          label: 'Sign out all other sessions',
          variant: 'secondary',
          confirm: {
            title: 'Sign out all other sessions',
            message: 'You will be signed out of all other devices and active sessions. This device will stay signed in.',
            confirmText: 'Sign out others',
          },
          action: async () => {
            await api.auth.logoutOthers();
          },
        },
        {
          id: 'logout-all',
          optionType: 'button',
          icon: <IconLogout2 size={18} strokeWidth={1.75} />,
          title: 'Log out everywhere',
          description: 'Sign out of all devices and active sessions.',
          label: 'Log out everywhere',
          variant: 'secondary',
          confirm: {
            title: 'Log out everywhere',
            message: 'You will be signed out of all devices and active sessions, including this one.',
            confirmText: 'Log out everywhere',
          },
          action: async () => {
            await api.auth.logoutAll();
            await navigate('/auth', { replace: true });
          },
        },
      ],
    },
    {
      id: 'security',
      title: 'Security',
      options: [
        {
          id: 'change-password',
          optionType: 'button',
          icon: <IconLock size={18} strokeWidth={1.75} />,
          title: 'Change password',
          description: 'Set a new password. All devices will be signed out.',
          label: 'Change password',
          variant: 'secondary',
          action: () => setIsChangePasswordOpen(true),
        },
        {
          id: 'sessions',
          optionType: 'button',
          icon: <IconShieldLock size={18} strokeWidth={1.75} />,
          title: 'Active sessions',
          description: 'See where your account is signed in, with approximate location and device.',
          label: 'View sessions',
          variant: 'secondary',
          action: () => setIsSessionsOpen(true),
        },
      ],
    },
    {
      id: 'danger',
      title: 'Danger Zone',
      options: [
        {
          id: 'delete-account',
          optionType: 'button',
          icon: <IconTrash size={18} strokeWidth={1.75} />,
          title: 'Delete account',
          description: 'Permanently delete your account and all associated data.',
          label: 'Delete account',
          variant: 'danger',
          danger: true,
          confirm: {
            title: 'Delete Account',
            message: 'This will permanently delete your account and all associated data. This action cannot be undone. Confirm your password to continue.',
            confirmText: 'Delete account',
            dangerous: true,
            requirePassword: true,
          },
          action: async ({ password }) => {
            await api.auth.deleteAccount({ password: password ?? '' });
            await navigate('/auth', { replace: true });
          },
        },
      ],
    },
    {
      id: 'developer',
      title: 'Developer',
      options: [
        {
          id: 'developer-account',
          optionType: 'checkbox',
          icon: <IconApps size={18} strokeWidth={1.75} />,
          title: 'Developer account',
          description: 'Enable developer features like creating apps.',
          checked: user?.developerAccount === true,
          onChange: async (checked) => {
            try {
              const updated = await api.users.setDeveloperAccount(checked);
              setUser(updated);
            } catch (err) {
              console.error('Failed to update developer account:', err);
            }
          },
        },
      ],
    },
    {
      id: 'preferences',
      title: 'Preferences',
      options: [
        {
          id: 'default-tab',
          optionType: 'select',
          icon: <IconLayoutDashboard size={18} strokeWidth={1.75} />,
          title: 'Default dashboard view',
          description: 'Choose which tab opens when you visit the dashboard.',
          value: defaultTab,
          options: [
            { value: 'overview', label: 'Overview' },
            { value: 'devices', label: 'Devices' },
            ...(isStaff ? [{ value: 'users', label: 'Users' }] : []),
            ...(isDeveloper ? [{ value: 'my-apps', label: 'My Apps' }] : []),
          ],
          onChange: setDefaultTabPref,
        },
        {
          id: 'compact-layout',
          optionType: 'checkbox',
          icon: <IconAdjustmentsHorizontal size={18} strokeWidth={1.75} />,
          title: 'Compact layout',
          description: 'Reduce padding and tighten the dashboard layout.',
          checked: compactLayout,
          onChange: setCompactPref,
        },
      ],
    },
  ], [defaultTab, compactLayout, navigate, isStaff, isDeveloper, user]);

  if (isLoading) {
    return (
      <div className={`dashboard-layout ${compactLayout ? 'dashboard-layout--compact' : ''}`}>
        <Sidebar activeTab={activePage} onChange={changeTab} username={user?.username ?? '...'} isDeveloper={isDeveloper} credits={credits} />
        <main className="dashboard-main">
          <Card className="dashboard-page__card" elevated>
            <CardBody>
              <p>Loading dashboard...</p>
            </CardBody>
          </Card>
        </main>
      </div>
    );
  }

  if (!user) {
    return (
      <div className={`dashboard-layout ${compactLayout ? 'dashboard-layout--compact' : ''}`}>
        <Sidebar activeTab={activePage} onChange={changeTab} username={'guest'} isDeveloper={isDeveloper} credits={credits} />
        <main className="dashboard-main">
          <Card className="dashboard-page__card" elevated>
            <CardBody>
              <p>Could not load user profile.</p>
            </CardBody>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className={`dashboard-layout ${compactLayout ? 'dashboard-layout--compact' : ''}`}>
      <Sidebar activeTab={activePage} onChange={changeTab} username={user.username} badges={user.badges} country={user.country} avatarUrl={user.avatarUrl} isSuspended={isSuspended} isStaff={isStaff} isDeveloper={isDeveloper} credits={credits} accounts={accounts} activeToken={api.getAuthToken()} onSwitchAccount={handleSwitchAccount} onLogoutAccount={handleLogoutAccount} />
      <main className="dashboard-main">
        {isSuspended && activePage !== 'profile' && activePage !== 'account-settings' && activePage !== 'settings' && activePage !== 'credits' ? (
          <Card className="dashboard-page__card" elevated>
            <CardHeader>
              <h2>Account Suspended</h2>
              <p>You are currently under a suspension</p>
            </CardHeader>
            <CardBody>
              <div className="dashboard-page__punishment-info">
                <div className="dashboard-page__punishment-field">
                  <span className="dashboard-page__punishment-label">Reason:</span>
                  <span className="dashboard-page__punishment-value">{activeSuspension.reason}</span>
                </div>
                <div className="dashboard-page__punishment-field">
                  <span className="dashboard-page__punishment-label">Issued by:</span>
                  <span className="dashboard-page__punishment-value">{activeSuspension.issuedByUsername}</span>
                </div>
                <div className="dashboard-page__punishment-field">
                  <span className="dashboard-page__punishment-label">Issued:</span>
                  <span className="dashboard-page__punishment-value">{getRelativeTime(activeSuspension.issuedAt)} ({formatDisplayDate(activeSuspension.issuedAt)})</span>
                </div>
                <div className="dashboard-page__punishment-field">
                  <span className="dashboard-page__punishment-label">Ends:</span>
                  <span className="dashboard-page__punishment-value">
                    {activeSuspension.endsAt ? (
                      <>
                        {getTimeRemaining(activeSuspension.endsAt)} ({formatDisplayDate(activeSuspension.endsAt)})
                      </>
                    ) : (
                      'Permanent'
                    )}
                  </span>
                </div>
                <div className="dashboard-page__punishment-field">
                  <span className="dashboard-page__punishment-label">Time remaining:</span>
                  <PunishmentCountdown
                    endsAt={activeSuspension.endsAt}
                    isPermanent={activeSuspension.endsAt === null}
                  />
                </div>
              </div>
              {isStaff && (
                <Button
                  onClick={handleLiftSuspension}
                  isLoading={isLiftingPunishment}
                  disabled={isLiftingPunishment}
                  variant="danger"
                  className="dashboard-page__lift-button"
                >
                  Lift Suspension
                </Button>
              )}
            </CardBody>
          </Card>
        ) : (
          <>
            {activePage === 'overview' && (
              <Card className="dashboard-page__card" elevated>
                <CardHeader>
                  <h2>Dashboard</h2>
                  <p>Profile summary</p>
                </CardHeader>

                <CardBody>
                  <UsernameDisplay
                    username={user.username}
                    badges={user.badges}
                    country={user.country}
                    avatarUrl={user.avatarUrl}
                    avatarSize={40}
                    className="dashboard-page__user-row"
                  />
                  <p>Welcome to your dashboard!</p>
                </CardBody>
              </Card>
            )}

            {activePage === 'devices' && (
              <Card className="dashboard-page__card" elevated>
                <CardHeader>
                  <h2>Devices</h2>
                  <p>Ayphr devices registered to your account</p>
                </CardHeader>
                <CardBody>
                  <Suspense fallback={<p>Loading...</p>}>
                    <DevicesPanel />
                  </Suspense>
                </CardBody>
              </Card>
            )}

            {activePage === 'locations' && (
              <Card className="dashboard-page__card dashboard-page__card--wide" elevated>
                <CardHeader>
                  <h2>Locations</h2>
                  <p>Group your devices into locations</p>
                </CardHeader>
                <CardBody>
                  <Suspense fallback={<p>Loading...</p>}>
                    <LocationsPanel />
                  </Suspense>
                </CardBody>
              </Card>
            )}

            {activePage === 'profile' && (
              <Card className="dashboard-page__card dashboard-page__card--wide" elevated>
                <CardHeader>
                  <h2>Profile</h2>
                  <p>Your profile information</p>
                </CardHeader>
                <CardBody>
                  <ProfileCard
                    userUuid={user.uuid}
                    viewerUuid={user.uuid}
                    viewerRole={user.role}
                    canEditProfile
                    onPunishSelf={handleSelfPunishment}
                  />
                </CardBody>
              </Card>
            )}

            {(activePage === 'settings' || activePage === 'account-settings') && (
              <Card className="dashboard-page__card dashboard-page__card--wide" elevated>
                <CardHeader>
                  <h2>Settings</h2>
                  <p>Manage your account, sessions, and preferences</p>
                </CardHeader>
                <CardBody>
                  <SettingsPanel sections={settingsSections} />
                </CardBody>
              </Card>
            )}

            {activePage === 'subscription' && (
              <Card className="dashboard-page__card" elevated>
                <CardHeader>
                  <h2>Subscription</h2>
                  <p>Manage your Ayphr subscription and billing</p>
                </CardHeader>
                <CardBody>
                  <Suspense fallback={<p>Loading...</p>}>
                    <SubscriptionPanel />
                  </Suspense>
                </CardBody>
              </Card>
            )}

            {activePage === 'credits' && (
              <Card className="dashboard-page__card dashboard-page__card--wide" elevated>
                <CardHeader>
                  <h2>Credits</h2>
                  <p>Your monthly allowance, additional credits, and held credits</p>
                </CardHeader>
                <CardBody>
                  <Suspense fallback={<p>Loading...</p>}>
                    <CreditsPanel key={user.uuid} initialCredits={credits} onCreditsChange={setCredits} />
                  </Suspense>
                </CardBody>
              </Card>
            )}

            {activePage === 'my-apps' && isDeveloper && (
              <Card className="dashboard-page__card dashboard-page__card--fit" elevated>
                <CardHeader>
                  <h2>My Apps</h2>
                  <p>Create and manage your Ayphr apps</p>
                </CardHeader>
                <CardBody>
                  <Suspense fallback={<p>Loading...</p>}>
                    <MyAppsPanel />
                  </Suspense>
                </CardBody>
              </Card>
            )}

            {activePage === 'connections' && (
              <Card className="dashboard-page__card" elevated>
                <CardHeader>
                  <h2>Connections</h2>
                  <p>Apps connected to your account</p>
                </CardHeader>
                <CardBody>
                  <Suspense fallback={<p>Loading...</p>}>
                    <ConnectionsPanel />
                  </Suspense>
                </CardBody>
              </Card>
            )}

            {activePage === 'users' && isStaff && (
              <Card className="dashboard-page__card dashboard-page__card--full" elevated>
                <CardHeader>
                  <h2>Users</h2>
                  <p>Search and manage Ayphr users</p>
                </CardHeader>
                <CardBody>
                  <Suspense fallback={<p>Loading...</p>}>
                    <UsersPanel />
                  </Suspense>
                </CardBody>
              </Card>
            )}

            {activePage === 'games' && (
              <Card className="dashboard-page__card dashboard-page__card--full" elevated>
                <CardHeader>
                  <h2>Games</h2>
                  <p>Take a break with a few small games</p>
                </CardHeader>
                <CardBody>
                  <Suspense fallback={<p>Loading...</p>}>
                    <GamesPanel />
                  </Suspense>
                </CardBody>
              </Card>
            )}
          </>
        )}
      </main>
      <SessionsModal isOpen={isSessionsOpen} onClose={() => setIsSessionsOpen(false)} />
      {isChangePasswordOpen && (
        <ChangePasswordModal
          isOpen={isChangePasswordOpen}
          onClose={() => setIsChangePasswordOpen(false)}
          onChanged={() => {
            setIsChangePasswordOpen(false);
            void navigate('/auth', { replace: true });
          }}
        />
      )}
    </div>
  );
};
