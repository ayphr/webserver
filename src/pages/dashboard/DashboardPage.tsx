import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { IconCheck, IconClock, IconX, IconSend, IconChevronDown, IconChevronUp, IconGavel } from '@tabler/icons-react';
import { api } from '../../lib/api';
import { getStoredAccounts, removeStoredAccount, setActiveToken, updateStoredAccount, type StoredAccount } from '../../lib/accounts';
import { toDate } from '../../lib/date';
import type { Punishment, SelfUser, CreditBalance, Appeal, AssistantVariant, AssistantSendShortcut } from '@common';
import { ASSISTANT_VARIANTS, getPlanFeaturesForUser } from '@common';

import { ProfileCard, Button, AssistantInput, Pagination, ProgressBar } from '../../components/common';
import { AssistantMetricsPanel, AssistantSidebar, useAssistantState, type AssistantChatAction } from '../../components/assistant';
import { Sidebar } from '../../components/layout';
import { SessionsModal, ChangePasswordModal, ChangeEmailModal, ChangeUsernameModal } from '../../components/settings';
import { SettingsPanel } from '../../components/settings';
import { OverviewPanel } from '../../components/overview/OverviewPanel';
import { DashboardContentSkeleton, DashboardLoadingSkeleton } from './DashboardLoadingSkeleton';
import { useDashboardClock } from './useDashboardClock';
import { buildSettingsSections } from './dashboardSettings';

const DevicesPanel = lazy(() => import('../../components/devices').then((m) => ({ default: m.DevicesPanel })));
const LocationsPanel = lazy(() => import('../../components/locations').then((m) => ({ default: m.LocationsPanel })));
const NotificationsPanel = lazy(() => import('../../components/notifications').then((m) => ({ default: m.NotificationsPanel })));
const CreditsPanel = lazy(() => import('../../components/credits').then((m) => ({ default: m.CreditsPanel })));
const TeamPanel = lazy(() => import('../../components/team/TeamPanel').then((m) => ({ default: m.TeamPanel })));
const IntegrationsPanel = lazy(() => import('../../components/integrations').then((m) => ({ default: m.IntegrationsPanel })));
const UsersPanel = lazy(() => import('../../components/staff').then((m) => ({ default: m.UsersPanel })));
const GamesPanel = lazy(() => import('../../components/games/GamesPanel').then((m) => ({ default: m.GamesPanel })));
import './DashboardPage.css';

const VALID_TABS = new Set(['assistant', 'assistant-metrics', 'overview', 'devices', 'locations', 'profile', 'settings', 'account-settings', 'notifications', 'credits', 'users', 'games', 'team', 'team-audit', 'integrations', 'appeal', 'appeals']);

function formatDisplayDate(date: Date | string): string {
  return toDate(date).toLocaleDateString('en-GB');
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
  return stored === 'overview' || stored === 'devices' || stored === 'users' || stored === 'assistant-metrics' ? stored : 'overview';
}

type DashboardPanelProps = {
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
};

const DashboardPanel = ({ title, description, className = '', children }: DashboardPanelProps) => (
  <section className={`dashboard-panel ${className}`}>
    <header className="dashboard-panel__header">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </header>
    <div className="dashboard-panel__content">{children}</div>
  </section>
);

export const DashboardPage = () => {
  const [user, setUser] = useState<SelfUser | null>(null);
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const [activeSuspension, setActiveSuspension] = useState<Punishment | null>(null);
  const [isSuspensionDetailsOpen, setIsSuspensionDetailsOpen] = useState(false);
  const [existingAppeal, setExistingAppeal] = useState<Appeal | null>(null);
  const [appealText, setAppealText] = useState('');
  const [isSubmittingAppeal, setIsSubmittingAppeal] = useState(false);
  const [appealError, setAppealError] = useState<string | null>(null);
  const [staffAppeals, setStaffAppeals] = useState<Appeal[]>([]);
  const [appealsPage, setAppealsPage] = useState(1);
  const APPEALS_PAGE_SIZE = 5;
  const appealsTotalPages = Math.max(1, Math.ceil(staffAppeals.length / APPEALS_PAGE_SIZE));
  const safeAppealsPage = Math.min(appealsPage, appealsTotalPages);
  const [isAppealsLoading, setIsAppealsLoading] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [activePage, setActivePage] = useState<string>(() => {
    const tab = searchParams.get('tab');
    return tab && VALID_TABS.has(tab) ? tab : getStoredDefaultTab();
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isLiftingPunishment, setIsLiftingPunishment] = useState(false);
  const [isSessionsOpen, setIsSessionsOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isChangeEmailOpen, setIsChangeEmailOpen] = useState(false);
  const [isChangeUsernameOpen, setIsChangeUsernameOpen] = useState(false);
  const [defaultTab, setDefaultTab] = useState<string>(getStoredDefaultTab);
  const [sidebarPinned, setSidebarPinned] = useState<boolean>(
    () => localStorage.getItem('ayphr-pref-sidebar-pinned') === '1',
  );
  const assistant = useAssistantState();
  const [chatAction, setChatAction] = useState<AssistantChatAction | null>(null);
  const chatActionTokenRef = useRef(0);
  const [accounts, setAccounts] = useState<StoredAccount[]>(() => getStoredAccounts());
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [deviceToOpen, setDeviceToOpen] = useState<number | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    const loadUnread = async () => {
      try {
        const count = await api.notifications.unreadCount();
        if (!cancelled) setUnreadNotifications(count);
      } catch {
        // Best effort; the sidebar count is not critical.
      }
    };

    void loadUnread();
    const interval = setInterval(() => void loadUnread(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uuid]);

  useEffect(() => {
    if (!activeSuspension) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExistingAppeal(null);
      return;
    }
    let active = true;
    api.punishments.getAppeal(activeSuspension.id)
      .then((appeal) => { if (active) setExistingAppeal(appeal); })
      .catch(() => { if (active) setExistingAppeal(null); });
    return () => { active = false; };
  }, [activeSuspension]);

  useEffect(() => {
    if (activePage !== 'appeals' || user?.role !== 'staff') return;
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsAppealsLoading(true);
    api.staff.appeals.list()
      .then((appeals) => { if (active) setStaffAppeals(appeals); })
      .catch(() => { if (active) setStaffAppeals([]); })
      .finally(() => { if (active) setIsAppealsLoading(false); });
    return () => { active = false; };
  }, [activePage, user]);

  useEffect(() => {
    if (appealsPage > appealsTotalPages) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAppealsPage(appealsTotalPages);
    }
  }, [appealsPage, appealsTotalPages]);

  useEffect(() => {
    const inviteToken = searchParams.get('invite');
    if (!inviteToken || !user) return;
    let cancelled = false;
    (async () => {
      try {
        await api.teams.acceptInvite(inviteToken);
        if (cancelled) return;
        api.users.invalidateMe();
        const userData = await api.users.me();
        if (cancelled) return;
        setUser(userData.user);
        setCredits(userData.credits);
        setActiveSuspension(userData.activeSuspension);
      } catch (err) {
        console.error('Failed to accept team invite:', err);
        if (!cancelled) setInviteError(err instanceof Error ? err.message : 'Failed to accept team invite');
      } finally {
        if (!cancelled) {
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.delete('invite');
            return next;
          }, { replace: true });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [searchParams, setSearchParams, user]);

  const now = useDashboardClock();
  const isSuspended = activeSuspension !== null;
  const suspensionProgress = activeSuspension?.endsAt
    ? Math.min(100, Math.max(0, ((now - toDate(activeSuspension.issuedAt).getTime()) / (toDate(activeSuspension.endsAt).getTime() - toDate(activeSuspension.issuedAt).getTime())) * 100))
    : null;
  const isStaff = user?.role === 'staff';
  const isTeamMember = Boolean(user?.teamId);
  const isTeamManager = user?.teamRole === 'manager';

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

  const handleSubmitAppeal = async () => {
    if (!activeSuspension || !appealText.trim()) return;
    setIsSubmittingAppeal(true);
    setAppealError(null);
    try {
      await api.punishments.submitAppeal(activeSuspension.id, appealText.trim());
      const appeal = await api.punishments.getAppeal(activeSuspension.id);
      setExistingAppeal(appeal);
      setAppealText('');
    } catch (err) {
      setAppealError(err instanceof Error ? err.message : 'Failed to submit appeal');
    } finally {
      setIsSubmittingAppeal(false);
    }
  };

  const handleResolveStaffAppeal = async (appealId: string, decision: 'lift' | 'deny') => {
    try {
      await api.staff.appeals.resolve(appealId, decision);
      setStaffAppeals((prev) => prev.filter((a) => a.id !== appealId));
    } catch (err) {
      console.error('Failed to resolve appeal:', err);
    }
  };


  const handleSwitchAccount = async (token: string) => {
    setActiveToken(token);
    api.users.invalidateMe();
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
    if (value !== 'devices') {
      setDeviceToOpen(null);
    }
    setActivePage(value);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', value);
      return next;
    }, { replace: true });
  };

  const handleSidebarNewChat = () => {
    assistant.update((current) => ({ ...current, activeChatId: null }));
    chatActionTokenRef.current += 1;
    setChatAction({ type: 'new', token: chatActionTokenRef.current });
    changeTab('assistant');
  };

  const handleSidebarOpenChat = (id: string) => {
    assistant.update((current) => ({ ...current, activeChatId: id }));
    chatActionTokenRef.current += 1;
    setChatAction({ type: 'open', token: chatActionTokenRef.current, chatId: id });
    changeTab('assistant');
  };

  const handleSidebarDeleteChat = (id: string) => {
    const wasActive = assistant.state.activeChatId === id;
    assistant.deleteChat(id);
    if (wasActive) {
      chatActionTokenRef.current += 1;
      setChatAction({ type: 'new', token: chatActionTokenRef.current });
    }
  };

  const openDevice = (serial: number) => {
    setDeviceToOpen(serial);
    changeTab('devices');
  };

  useEffect(() => {
    if (!isLoading && user && activePage === 'users' && user.role !== 'staff') {
      changeTab('overview');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, user, activePage]);

  useEffect(() => {
    if (activePage === 'team-audit') {
      changeTab('team');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage]);

  const setDefaultTabPref = (value: string) => {
    setDefaultTab(value);
    localStorage.setItem('ayphr-pref-default-tab', value);
  };

  const setSidebarPinnedPref = (checked: boolean) => {
    setSidebarPinned(checked);
    localStorage.setItem('ayphr-pref-sidebar-pinned', checked ? '1' : '0');
  };

  const assistantVariant = assistant.preferences.defaultVariant;
  const assistantSendShortcut = assistant.preferences.sendShortcut;

  const updateAssistantPreferences = assistant.updatePreferences;
  const setAssistantVariantPref = useCallback(
    (value: AssistantVariant) => updateAssistantPreferences({ defaultVariant: value }),
    [updateAssistantPreferences],
  );

  const setAssistantSendShortcutPref = useCallback(
    (value: AssistantSendShortcut) => updateAssistantPreferences({ sendShortcut: value }),
    [updateAssistantPreferences],
  );

  const availableAssistantVariants = useMemo(
    () => (user ? getPlanFeaturesForUser(user).availableAssistantVariants : ASSISTANT_VARIANTS),
    [user],
  );

  const effectiveAssistantVariant = availableAssistantVariants.includes(assistantVariant)
    ? assistantVariant
    : availableAssistantVariants.includes('standard')
      ? 'standard'
      : (availableAssistantVariants[0] ?? 'nano');

  const settingsSections = useMemo(
    () =>
      buildSettingsSections({
        user,
        credits,
        defaultTab,
        setDefaultTabPref,
        sidebarPinned,
        setSidebarPinnedPref,
        assistantVariant: effectiveAssistantVariant,
        setAssistantVariantPref,
        availableAssistantVariants,
        assistantSendShortcut,
        setAssistantSendShortcutPref,
        isStaff,
        now,
        navigate,
        setIsSessionsOpen,
        setIsChangePasswordOpen,
        setIsChangeEmailOpen,
        setIsChangeUsernameOpen,
      }),
    [credits, defaultTab, sidebarPinned, effectiveAssistantVariant, setAssistantVariantPref, availableAssistantVariants, assistantSendShortcut, setAssistantSendShortcutPref, navigate, isStaff, user, now],
  );

  if (isLoading || assistant.isLoading) {
    return <DashboardLoadingSkeleton activeTab={activePage} />;
  }

  if (!user) {
    return (
      <div className={`dashboard-layout`}>
        <Sidebar activeTab={activePage} onChange={changeTab} username={'guest'} isTeamMember={isTeamMember} isTeamManager={isTeamManager} pinned={sidebarPinned} credits={credits} />
        <main className="dashboard-main">
          <DashboardPanel title="Dashboard">
            <p>Could not load user profile.</p>
          </DashboardPanel>
        </main>
      </div>
    );
  }

  return (
    <div className={`dashboard-layout`}>
      <Sidebar activeTab={activePage} onChange={changeTab} username={user.username} badges={user.badges} country={user.country} avatarUrl={user.avatarUrl} isSuspended={isSuspended} isStaff={isStaff} isTeamMember={isTeamMember} isTeamManager={isTeamManager} pinned={sidebarPinned} credits={credits} accounts={accounts} activeToken={api.getAuthToken()} onSwitchAccount={handleSwitchAccount} onLogoutAccount={handleLogoutAccount} unreadNotifications={unreadNotifications} />
      <main className="dashboard-main">
        {isSuspended && activePage !== 'profile' && activePage !== 'account-settings' && activePage !== 'settings' && activePage !== 'credits' && activePage !== 'appeal' && activePage !== 'notifications' && activePage !== 'assistant-metrics' ? (
          <DashboardPanel title="Account Suspended" description="You are currently under a suspension">
            <div className="dashboard-page__suspension-card">
              <div className="dashboard-page__suspension-card__header">
                <span className="dashboard-page__suspension-card__countdown">
                  <PunishmentCountdown
                    endsAt={activeSuspension.endsAt}
                    isPermanent={activeSuspension.endsAt === null}
                  />
                </span>
                <span className="dashboard-page__suspension-card__countdown-label">remaining</span>
              </div>
              <div className="dashboard-page__suspension-card__reason">
                <span className="dashboard-page__suspension-card__label">Reason</span>
                <p className="dashboard-page__suspension-card__reason-text">{activeSuspension.reason}</p>
              </div>
              {suspensionProgress !== null && (
                <div className="dashboard-page__suspension-card__progress">
                  <div className="dashboard-page__suspension-card__progress-bar">
                    <ProgressBar value={suspensionProgress} color="var(--status-error)" />
                  </div>
                  <span className="dashboard-page__suspension-card__progress-label">{Math.round(suspensionProgress)}% elapsed</span>
                </div>
              )}
              <button
                type="button"
                className="dashboard-page__suspension-card__toggle"
                onClick={() => setIsSuspensionDetailsOpen((open) => !open)}
              >
                {isSuspensionDetailsOpen ? 'Hide details' : 'More info'}
                {isSuspensionDetailsOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
              </button>
              {isSuspensionDetailsOpen && (
                <div className="dashboard-page__suspension-card__meta">
                  <div>
                    <span className="dashboard-page__suspension-card__label">Issued by</span>
                    <span className="dashboard-page__suspension-card__value">{activeSuspension.issuedByUsername}</span>
                  </div>
                  <div>
                    <span className="dashboard-page__suspension-card__label">Issued</span>
                    <span className="dashboard-page__suspension-card__value">{formatDisplayDate(activeSuspension.issuedAt)}</span>
                  </div>
                  <div>
                    <span className="dashboard-page__suspension-card__label">Ends</span>
                    <span className="dashboard-page__suspension-card__value">
                      {activeSuspension.endsAt ? formatDisplayDate(activeSuspension.endsAt) : 'Permanent'}
                    </span>
                  </div>
                </div>
              )}
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
          </DashboardPanel>
        ) : (
          <>
            {activePage === 'assistant' && (
              <div className="dashboard-assistant">
                <AssistantSidebar
                  folders={assistant.state.folders}
                  chats={assistant.state.chats}
                  activeChatId={assistant.state.activeChatId}
                  isAssistantView
                  onNewChat={handleSidebarNewChat}
                  onOpenChat={handleSidebarOpenChat}
                  onRenameFolder={assistant.renameFolder}
                  onDeleteFolder={assistant.deleteFolder}
                  onRenameChat={assistant.renameChat}
                  onDeleteChat={handleSidebarDeleteChat}
                  onTogglePinChat={assistant.togglePinChat}
                  onReorderFolders={assistant.reorderFolders}
                  onReorderChat={assistant.reorderChat}
                  onMoveChat={assistant.moveChat}
                />
                <AssistantInput
                  availableVariants={availableAssistantVariants}
                  username={user.username}
                  defaultVariant={effectiveAssistantVariant}
                  dataShared={getPlanFeaturesForUser(user).dataShared}
                  sendShortcut={assistantSendShortcut}
                  assistant={assistant}
                  chatAction={chatAction}
                />
              </div>
            )}

            {activePage === 'assistant-metrics' && (
              <div className="dashboard-panel dashboard-panel--full">
                <div className="dashboard-panel__content">
                  <AssistantMetricsPanel />
                </div>
              </div>
            )}

            {activePage === 'overview' && (
              <DashboardPanel
                title="Overview"
                description="A summary of your account and devices"
                className="dashboard-panel--wide"
              >
                <OverviewPanel
                  user={user}
                  credits={credits}
                  onNavigate={changeTab}
                  onDeviceNavigate={openDevice}
                />
              </DashboardPanel>
            )}

            {activePage === 'devices' && (
              <DashboardPanel
                title="Devices"
                description="Ayphr devices registered to your account"
                className="dashboard-panel--devices"
              >
                <Suspense fallback={<DashboardContentSkeleton />}>
                  <DevicesPanel initialDeviceSerial={deviceToOpen} onNavigate={changeTab} credits={credits} onCreditsChange={setCredits} />
                </Suspense>
              </DashboardPanel>
            )}

            {activePage === 'locations' && (
              <DashboardPanel
                title="Locations"
                description="Group your devices into locations"
                className="dashboard-panel--wide"
              >
                <Suspense fallback={<DashboardContentSkeleton />}>
                  <LocationsPanel onDeviceNavigate={openDevice} />
                </Suspense>
              </DashboardPanel>
            )}

            {activePage === 'profile' && (
              <DashboardPanel
                title="Profile"
                description="Your profile information"
                className="dashboard-panel--wide"
              >
                <ProfileCard
                  userUuid={user.uuid}
                  viewerUuid={user.uuid}
                  viewerRole={user.role}
                  canEditProfile
                  onPunishSelf={handleSelfPunishment}
                />
              </DashboardPanel>
            )}

            {(activePage === 'settings' || activePage === 'account-settings') && (
              <DashboardPanel
                title="Settings"
                description="Manage your account, sessions, and preferences"
                className="dashboard-panel--wide"
              >
                <SettingsPanel sections={settingsSections} />
              </DashboardPanel>
            )}

            {activePage === 'notifications' && (
              <DashboardPanel
                title="Notifications"
                description="Updates about your account, team, and security"
                className="dashboard-panel--wide"
              >
                <Suspense fallback={<DashboardContentSkeleton />}>
                  <NotificationsPanel
                    onNavigate={changeTab}
                    onUnreadChange={setUnreadNotifications}
                  />
                </Suspense>
              </DashboardPanel>
            )}

            {activePage === 'credits' && (
              <DashboardPanel
                title="Credits"
                description="Your monthly allowance, additional credits, and held credits"
                className="dashboard-panel--wide"
              >
                <Suspense fallback={<DashboardContentSkeleton />}>
                  <CreditsPanel key={user.uuid} initialCredits={credits} onCreditsChange={setCredits} />
                </Suspense>
              </DashboardPanel>
            )}

            {activePage === 'users' && isStaff && (
              <DashboardPanel
                title="Users"
                description="Search and manage Ayphr users"
                className="dashboard-panel--full"
              >
                <Suspense fallback={<DashboardContentSkeleton />}>
                  <UsersPanel />
                </Suspense>
              </DashboardPanel>
            )}

            {(activePage === 'team' || activePage === 'team-audit') && isTeamMember && (
              <DashboardPanel title="Team" description="Manage your team members" className="dashboard-panel--wide">
                <Suspense fallback={<DashboardContentSkeleton />}>
                  <TeamPanel isManager={isTeamManager} userUuid={user?.uuid} />
                </Suspense>
              </DashboardPanel>
            )}

            {activePage === 'integrations' && isTeamMember && (
              <DashboardPanel title="Integrations" description="Webhooks shared with your team" className="dashboard-panel--wide">
                <Suspense fallback={<DashboardContentSkeleton />}>
                  <IntegrationsPanel isManager={isTeamManager} />
                </Suspense>
              </DashboardPanel>
            )}

            {activePage === 'games' && (
              <DashboardPanel
                title="Games"
                description="Take a break with a few small games"
                className="dashboard-panel--full dashboard-panel--centered"
              >
                <Suspense fallback={<DashboardContentSkeleton />}>
                  <GamesPanel />
                </Suspense>
              </DashboardPanel>
            )}

            {activePage === 'appeal' && isSuspended && (
              <DashboardPanel title="Appeal suspension" description="You may submit one appeal per suspension" className="dashboard-panel--wide">
                {inviteError && <p className="dashboard-page__error">{inviteError}</p>}
                {existingAppeal ? (
                  <div className="dashboard-page__appeal-status">
                    <div className="dashboard-page__appeal-tracker" data-status={existingAppeal.status}>
                      <div className="dashboard-page__appeal-step dashboard-page__appeal-step--done">
                        <span className="dashboard-page__appeal-step-icon"><IconSend size={14} /></span>
                        <span className="dashboard-page__appeal-step-label">Submitted</span>
                      </div>
                      <div className="dashboard-page__appeal-step-line" />
                      <div className={`dashboard-page__appeal-step ${existingAppeal.status === 'pending' ? 'dashboard-page__appeal-step--active' : 'dashboard-page__appeal-step--done'}`}>
                        <span className="dashboard-page__appeal-step-icon"><IconClock size={14} /></span>
                        <span className="dashboard-page__appeal-step-label">Under review</span>
                      </div>
                      <div className="dashboard-page__appeal-step-line" />
                      <div className={`dashboard-page__appeal-step ${existingAppeal.status === 'pending' ? 'dashboard-page__appeal-step--pending' : existingAppeal.status === 'accepted' ? 'dashboard-page__appeal-step--success' : 'dashboard-page__appeal-step--danger'}`}>
                        <span className="dashboard-page__appeal-step-icon">
                            {existingAppeal.status === 'accepted' ? <IconCheck size={14} /> : existingAppeal.status === 'denied' ? <IconX size={14} /> : <IconGavel size={14} />}
                        </span>
                        <span className="dashboard-page__appeal-step-label">
                          {existingAppeal.status === 'accepted' ? 'Accepted' : existingAppeal.status === 'denied' ? 'Denied' : 'Decision'}
                        </span>
                      </div>
                    </div>
                    <p className="dashboard-page__appeal-status-text">
                      {existingAppeal.status === 'pending' && 'Your appeal is being reviewed by staff.'}
                      {existingAppeal.status === 'accepted' && 'Your appeal was accepted and the suspension was lifted.'}
                      {existingAppeal.status === 'denied' && 'Your appeal was denied.'}
                    </p>
                  </div>
                ) : (
                  <div className="dashboard-page__appeal">
                    <textarea
                      className="dashboard-page__appeal-textarea"
                      value={appealText}
                      onChange={(e) => setAppealText(e.target.value)}
                      rows={6}
                      placeholder="Explain why your suspension should be lifted..."
                    />
                    {appealError && <p className="dashboard-page__error">{appealError}</p>}
                    <Button className="dashboard-page__appeal-submit" onClick={() => void handleSubmitAppeal()} isLoading={isSubmittingAppeal} disabled={isSubmittingAppeal || !appealText.trim()}>
                      Submit appeal
                    </Button>
                  </div>
                )}
              </DashboardPanel>
            )}

            {activePage === 'appeals' && isStaff && (
              <DashboardPanel title="Appeals" description="User appeals against suspensions" className="dashboard-panel--wide">
                {isAppealsLoading ? (
                  <p>Loading appeals…</p>
                ) : staffAppeals.length === 0 ? (
                  <p>No pending appeals.</p>
                ) : (
                  <>
                    <div className="dashboard-page__appeals-list">
                      {staffAppeals
                        .slice((safeAppealsPage - 1) * APPEALS_PAGE_SIZE, safeAppealsPage * APPEALS_PAGE_SIZE)
                        .map((appeal) => (
                          <div key={appeal.id} className="dashboard-page__appeal-item">
                            <div className="dashboard-page__appeal-item__header">
                              <span className="dashboard-page__appeal-item__user">{appeal.userUsername}</span>
                            </div>
                            <p className="dashboard-page__appeal-item__text">{appeal.text}</p>
                            <div className="dashboard-page__appeal-item__actions">
                              <Button variant="primary" onClick={() => void handleResolveStaffAppeal(appeal.id, 'lift')}>Remove punishment</Button>
                              <Button variant="secondary" onClick={() => void handleResolveStaffAppeal(appeal.id, 'deny')}>Deny</Button>
                            </div>
                          </div>
                        ))}
                    </div>
                    <Pagination page={safeAppealsPage} totalPages={appealsTotalPages} onPageChange={setAppealsPage} />
                  </>
                )}
              </DashboardPanel>
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
      {isChangeEmailOpen && (
        <ChangeEmailModal
          isOpen={isChangeEmailOpen}
          onClose={() => setIsChangeEmailOpen(false)}
          onChanged={async (updatedUser) => {
            setIsChangeEmailOpen(false);
            setUser(updatedUser);
            const token = api.getAuthToken();
            if (token) updateStoredAccount(token, updatedUser);
            api.users.invalidateMe();
          }}
        />
      )}
      {isChangeUsernameOpen && (
        <ChangeUsernameModal
          isOpen={isChangeUsernameOpen}
          onClose={() => setIsChangeUsernameOpen(false)}
          onChanged={async (updatedUser) => {
            setIsChangeUsernameOpen(false);
            setUser(updatedUser);
            const token = api.getAuthToken();
            if (token) updateStoredAccount(token, updatedUser);
            api.users.invalidateMe();
          }}
        />
      )}
    </div>
  );
};
