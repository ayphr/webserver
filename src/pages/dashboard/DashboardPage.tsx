import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { IconAlertCircle, IconCheck, IconClock, IconX, IconSend, IconChevronDown, IconChevronUp, IconGavel } from '@tabler/icons-react';
import { api } from '../../lib/api';
import { getStoredAccounts, removeStoredAccount, setActiveToken, updateStoredAccount, type StoredAccount } from '../../lib/accounts';
import { formatDisplayDate, toDate } from '../../lib/date';
import {
  DASHBOARD_TABS,
  dashboardPath,
  parseDashboardPath,
  type DashboardTab,
  type DashboardTarget,
  type TeamSection,
} from '../../lib/dashboardRoutes';
import type { Punishment, SelfUser, CreditBalance, Appeal, AssistantVariant, AssistantSendShortcut } from '@common';
import { ASSISTANT_VARIANTS, getPlanFeaturesForUser } from '@common';

import { ProfileCard, Button, AssistantInput, Pagination, ProgressBar } from '../../components/common';
import { AssistantSidebar, useAssistantState, type AssistantChatAction } from '../../components/assistant';
import { Sidebar } from '../../components/layout';
import { SessionsModal, ChangePasswordModal, ChangeEmailModal, ChangeUsernameModal } from '../../components/settings';
import { SettingsPanel } from '../../components/settings';
import { OverviewPanel } from '../../components/overview/OverviewPanel';
import { DashboardContentSkeleton, DashboardLoadingSkeleton } from './DashboardLoadingSkeleton';
import { useDashboardClock } from './useDashboardClock';
import { buildSettingsSections } from './dashboardSettings';

const DevicesPanel = lazy(() => import('../../components/devices').then((m) => ({ default: m.DevicesPanel })));
const QueriesPanel = lazy(() => import('../../components/queries').then((m) => ({ default: m.QueriesPanel })));
const LocationsPanel = lazy(() => import('../../components/locations').then((m) => ({ default: m.LocationsPanel })));
const NotificationsPanel = lazy(() => import('../../components/notifications').then((m) => ({ default: m.NotificationsPanel })));
const CreditsPanel = lazy(() => import('../../components/credits').then((m) => ({ default: m.CreditsPanel })));
const TeamPanel = lazy(() => import('../../components/team/TeamPanel').then((m) => ({ default: m.TeamPanel })));
const IntegrationsPanel = lazy(() => import('../../components/integrations').then((m) => ({ default: m.IntegrationsPanel })));
const UsersPanel = lazy(() => import('../../components/staff').then((m) => ({ default: m.UsersPanel })));
const GamesPanel = lazy(() => import('../../components/games/GamesPanel').then((m) => ({ default: m.GamesPanel })));
const RadioPanel = lazy(() => import('../../components/radio/RadioPanel').then((m) => ({ default: m.RadioPanel })));
import './DashboardPage.css';

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

function getStoredDefaultTab(): DashboardTab {
  const stored = localStorage.getItem('ayphr-pref-default-tab');
  return DASHBOARD_TABS.find((tab) => tab === stored) ?? 'overview';
}

function getAcceptedInviteToken(): string | null {
  try {
    return sessionStorage.getItem('ayphr:accepted-invite');
  } catch {
    return null;
  }
}

function setAcceptedInviteToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem('ayphr:accepted-invite', token);
    else sessionStorage.removeItem('ayphr:accepted-invite');
  } catch {
    // Ignore storage restrictions; the in-memory ref still prevents duplicate accepts.
  }
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

type DashboardBannerProps = {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  isActionLoading?: boolean;
  onDismiss?: () => void;
};

const DashboardBanner = ({
  title,
  message,
  actionLabel,
  onAction,
  isActionLoading = false,
  onDismiss,
}: DashboardBannerProps) => (
  <div className="dashboard-page__banner" role="alert">
    <IconAlertCircle size={18} strokeWidth={1.75} />
    <div className="dashboard-page__banner-body">
      <strong className="dashboard-page__banner-title">{title}</strong>
      <span className="dashboard-page__banner-message">{message}</span>
    </div>
    <div className="dashboard-page__banner-actions">
      {onAction && actionLabel && (
        <Button variant="secondary" onClick={onAction} isLoading={isActionLoading} disabled={isActionLoading}>
          {actionLabel}
        </Button>
      )}
      {onDismiss && (
        <Button variant="secondary" onClick={onDismiss} disabled={isActionLoading}>
          Dismiss
        </Button>
      )}
    </div>
  </div>
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
  const [appealsError, setAppealsError] = useState<string | null>(null);
  const [appealsRetry, setAppealsRetry] = useState(0);
  const [resolvingAppealId, setResolvingAppealId] = useState<string | null>(null);
  const [appealResolveErrors, setAppealResolveErrors] = useState<Record<string, string>>({});
  const [appealsPage, setAppealsPage] = useState(1);
  const APPEALS_PAGE_SIZE = 5;
  const appealsTotalPages = Math.max(1, Math.ceil(staffAppeals.length / APPEALS_PAGE_SIZE));
  const safeAppealsPage = Math.min(appealsPage, appealsTotalPages);
  const [isAppealsLoading, setIsAppealsLoading] = useState(false);
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const legacyTab = searchParams.get('tab');
  const inviteToken = searchParams.get('invite');
  const storedDefaultTab = getStoredDefaultTab();
  const isStaff = user?.role === 'staff';
  const isTeamMember = Boolean(user?.teamId);
  // A stored preference for a tab the account cannot open falls back to Overview.
  const preferredDefaultTab: DashboardTab = storedDefaultTab === 'team' && !isTeamMember
    ? 'overview'
    : storedDefaultTab === 'users' && !isStaff
      ? 'overview'
      : storedDefaultTab;
  const dashboardRoute = useMemo(
    () => parseDashboardPath(location.pathname, legacyTab ?? preferredDefaultTab),
    [location.pathname, legacyTab, preferredDefaultTab],
  );
  const activePage = dashboardRoute.tab;
  const activeDevice = dashboardRoute.device;
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
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [dismissedInviteError, setDismissedInviteError] = useState<string | null>(null);
  const [inviteRetry, setInviteRetry] = useState(0);
  const [isAcceptingInvite, setIsAcceptingInvite] = useState(false);
  const acceptedInviteRef = useRef<string | null>(null);
  const [dismissedAssistantSyncError, setDismissedAssistantSyncError] = useState<string | null>(null);

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

  // Each tab shares one scroll container; start new views at the top.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  useEffect(() => {
    if (!activeSuspension) {
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
    if (activePage !== 'appeals' || !isStaff) return;
    let active = true;
    setIsAppealsLoading(true);
    setAppealsError(null);
    api.staff.appeals.list()
      .then((appeals) => { if (active) setStaffAppeals(appeals); })
      .catch((err) => {
        if (active) setAppealsError(err instanceof Error ? err.message : 'Failed to load appeals');
      })
      .finally(() => { if (active) setIsAppealsLoading(false); });
    return () => { active = false; };
  }, [activePage, isStaff, user, appealsRetry]);

  useEffect(() => {
    if (appealsPage > appealsTotalPages) {
      setAppealsPage(appealsTotalPages);
    }
  }, [appealsPage, appealsTotalPages]);

  useEffect(() => {
    if (!inviteToken || !user) return;
    let cancelled = false;
    (async () => {
      setIsAcceptingInvite(true);
      setInviteError(null);
      try {
        // A refresh-only retry must not accept the same token a second time.
        if (acceptedInviteRef.current !== inviteToken && getAcceptedInviteToken() !== inviteToken) {
          await api.teams.acceptInvite(inviteToken);
          if (cancelled) return;
          acceptedInviteRef.current = inviteToken;
          setAcceptedInviteToken(inviteToken);
        }
        api.users.invalidateMe();
        const userData = await api.users.me();
        if (cancelled) return;
        setUser(userData.user);
        setCredits(userData.credits);
        setActiveSuspension(userData.activeSuspension);
        // Only a fully successful accept/refresh clears the deep link; failures keep it for retry.
        setAcceptedInviteToken(null);
        acceptedInviteRef.current = null;
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.delete('invite');
          return next;
        }, { replace: true });
      } catch (err) {
        if (!cancelled) {
          setInviteError(
            err instanceof Error
              ? err.message
              : acceptedInviteRef.current === inviteToken
                ? 'Failed to refresh your account after joining the team'
                : 'Failed to accept team invite',
          );
        }
      } finally {
        if (!cancelled) setIsAcceptingInvite(false);
      }
    })();
    return () => { cancelled = true; };
  }, [searchParams, setSearchParams, user, inviteToken, inviteRetry]);

  const now = useDashboardClock();
  const isSuspended = activeSuspension !== null;
  const suspensionProgress = useMemo(() => {
    if (!activeSuspension?.endsAt) return null;
    const start = toDate(activeSuspension.issuedAt).getTime();
    const end = toDate(activeSuspension.endsAt).getTime();
    const span = end - start;
    if (!Number.isFinite(span) || span <= 0) return null;
    return Math.min(100, Math.max(0, ((now - start) / span) * 100));
  }, [activeSuspension, now]);
  const isTeamManager = user?.teamRole === 'manager';
  const canUseAlertsAndWebhooks = user ? getPlanFeaturesForUser(user).alertsAndWebhooks : false;

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
    setResolvingAppealId(appealId);
    setAppealResolveErrors((prev) => {
      const next = { ...prev };
      delete next[appealId];
      return next;
    });
    try {
      await api.staff.appeals.resolve(appealId, decision);
      setStaffAppeals((prev) => prev.filter((a) => a.id !== appealId));
    } catch (err) {
      setAppealResolveErrors((prev) => ({
        ...prev,
        [appealId]: err instanceof Error ? err.message : 'Failed to resolve appeal',
      }));
    } finally {
      setResolvingAppealId(null);
    }
  };

  const retryInvite = () => {
    setInviteError(null);
    setDismissedInviteError(null);
    setInviteRetry((value) => value + 1);
  };

  // Dismiss only hides the failure; the token stays in the URL so a reload can retry.
  const dismissInvite = () => setDismissedInviteError(inviteError);

  const retryAssistantSync = () => {
    setDismissedAssistantSyncError(null);
    assistant.retrySync();
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

  const navigateToDashboard = (value: string | DashboardTarget, options?: { replace?: boolean }) => {
    const target: DashboardTarget = typeof value === 'string'
      ? (() => {
          // Accept the old `?tab=` ids and internal aliases everywhere.
          const parsed = parseDashboardPath('/dashboard', value);
          return {
            tab: parsed.tab,
            ...(parsed.section ? { section: parsed.section } : {}),
            ...(parsed.device ? { device: parsed.device } : {}),
            ...(parsed.location ? { location: parsed.location } : {}),
          };
        })()
      : value;

    const targetPath = dashboardPath(target);

    const params = new URLSearchParams(searchParams);
    params.delete('tab');
    const query = params.toString();
    navigate(`${targetPath}${query ? `?${query}` : ''}`, { replace: options?.replace ?? false });
  };

  const changeTab = navigateToDashboard;

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
    navigateToDashboard({ tab: 'devices', device: { serial } });
  };

  // Normalize legacy `?tab=` links and unknown paths to canonical dashboard URLs.
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    params.delete('tab');
    const query = params.toString();
    const next = `${dashboardRoute.canonicalPath}${query ? `?${query}` : ''}`;
    if (next !== `${location.pathname}${location.search}`) {
      navigate(next, { replace: true });
    }
  }, [dashboardRoute.canonicalPath, location.pathname, location.search, navigate, searchParams]);

  useEffect(() => {
    if (!isLoading && user && activePage === 'users' && user.role !== 'staff') {
      navigateToDashboard('overview', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, user, activePage]);

  const setDefaultTabPref = (value: string) => {
    const next = DASHBOARD_TABS.find((tab) => tab === value) ?? 'overview';
    setDefaultTab(next);
    localStorage.setItem('ayphr-pref-default-tab', next);
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
        effectiveDefaultTab: preferredDefaultTab,
        setDefaultTabPref,
        sidebarPinned,
        setSidebarPinnedPref,
        assistantVariant: effectiveAssistantVariant,
        setAssistantVariantPref,
        availableAssistantVariants,
        assistantSendShortcut,
        setAssistantSendShortcutPref,
        isStaff,
        isTeamMember,
        now,
        navigate,
        setIsSessionsOpen,
        setIsChangePasswordOpen,
        setIsChangeEmailOpen,
        setIsChangeUsernameOpen,
      }),
    [credits, defaultTab, preferredDefaultTab, sidebarPinned, effectiveAssistantVariant, setAssistantVariantPref, availableAssistantVariants, assistantSendShortcut, setAssistantSendShortcutPref, navigate, isStaff, isTeamMember, user, now],
  );

  if (isLoading || assistant.isLoading) {
    return <DashboardLoadingSkeleton activeTab={activePage} />;
  }

  if (!user) {
    return (
      <div className={`dashboard-layout`}>
        <a className="sr-only skip-link" href="#main-content">Skip to content</a>
        <Sidebar activeTab={activePage} onChange={changeTab} username={'guest'} isTeamMember={isTeamMember} isTeamManager={isTeamManager} canUseAlertsAndWebhooks={canUseAlertsAndWebhooks} pinned={sidebarPinned} credits={credits} />
        <main className="dashboard-main" id="main-content" ref={mainRef} tabIndex={-1}>
          <DashboardPanel title="Dashboard">
            <p>Could not load user profile.</p>
          </DashboardPanel>
        </main>
      </div>
    );
  }

  return (
    <div className={`dashboard-layout`}>
      <a className="sr-only skip-link" href="#main-content">Skip to content</a>
      <Sidebar activeTab={activePage} onChange={changeTab} username={user.username} badges={user.badges} country={user.country} avatarUrl={user.avatarUrl} isSuspended={isSuspended} isStaff={isStaff} isTeamMember={isTeamMember} isTeamManager={isTeamManager} canUseAlertsAndWebhooks={canUseAlertsAndWebhooks} pinned={sidebarPinned} credits={credits} accounts={accounts} activeToken={api.getAuthToken()} onSwitchAccount={handleSwitchAccount} onLogoutAccount={handleLogoutAccount} unreadNotifications={unreadNotifications} />
      <main
        className={`dashboard-main${activePage === 'assistant' ? ' dashboard-main--assistant' : ''}`}
        id="main-content"
        ref={mainRef}
      >
        {inviteToken && inviteError && dismissedInviteError !== inviteError && (
          <DashboardBanner
            title="Could not accept team invite"
            message={inviteError}
            actionLabel="Try again"
            onAction={retryInvite}
            isActionLoading={isAcceptingInvite}
            onDismiss={dismissInvite}
          />
        )}
        {assistant.syncStatus === 'error' && assistant.syncError && dismissedAssistantSyncError !== assistant.syncError && (
          <DashboardBanner
            title="Iris could not sync"
            message={assistant.syncError}
            actionLabel="Retry"
            onAction={retryAssistantSync}
            onDismiss={() => setDismissedAssistantSyncError(assistant.syncError)}
          />
        )}
        {isSuspended && activePage !== 'profile' && activePage !== 'settings' && activePage !== 'credits' && activePage !== 'appeal' && activePage !== 'notifications' ? (
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
                <div className="dashboard-assistant__sidebar-slot">
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
                    onReorderFolders={assistant.reorderFolders}
                    onReorderChat={assistant.reorderChat}
                    onMoveChat={assistant.moveChat}
                  />
                </div>
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
                  <DevicesPanel
                    activeDevice={activeDevice ?? null}
                    onNavigate={navigateToDashboard}
                    credits={credits}
                    onCreditsChange={setCredits}
                  />
                </Suspense>
              </DashboardPanel>
            )}

            {activePage === 'queries' && (
              <Suspense fallback={<DashboardContentSkeleton />}>
                <QueriesPanel
                  user={user}
                  credits={credits}
                  onCreditsChange={setCredits}
                />
              </Suspense>
            )}

            {activePage === 'locations' && (
              <DashboardPanel
                title="Locations"
                description="Group your devices into locations"
                className="dashboard-panel--wide"
              >
                <Suspense fallback={<DashboardContentSkeleton />}>
                  <LocationsPanel
                    onDeviceNavigate={openDevice}
                    onNavigate={navigateToDashboard}
                    locationRoute={dashboardRoute.location ?? null}
                  />
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

            {activePage === 'settings' && (
              <DashboardPanel
                title="Settings"
                description="Manage your account, sessions, and preferences"
                className="dashboard-panel--wide"
              >
                <SettingsPanel
                  sections={settingsSections}
                  defaultTab={dashboardRoute.section}
                  onTabChange={(section) => navigateToDashboard({ tab: 'settings', section })}
                />
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

            {activePage === 'team' && isTeamMember && (
              <DashboardPanel title="Team" description="Manage your team members" className="dashboard-panel--wide">
                <Suspense fallback={<DashboardContentSkeleton />}>
                  <TeamPanel
                    isManager={isTeamManager}
                    userUuid={user?.uuid}
                    initialTab={dashboardRoute.section as TeamSection | undefined}
                    onTabChange={(section) => navigateToDashboard({ tab: 'team', section })}
                  />
                </Suspense>
              </DashboardPanel>
            )}

            {activePage === 'integrations' && isTeamMember && !canUseAlertsAndWebhooks && (
              <DashboardPanel title="Integrations" description="Webhooks shared with your team" className="dashboard-panel--wide">
                <p>Alerts and webhooks are available on Plus and all team plans.</p>
                <Button variant="primary" onClick={() => changeTab('credits')}>
                  View plans
                </Button>
              </DashboardPanel>
            )}

            {activePage === 'integrations' && isTeamMember && canUseAlertsAndWebhooks && (
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

            {activePage === 'radio' && (
              <DashboardPanel
                title="Radio"
                description="A little quiet company while you work"
                className="dashboard-panel--full dashboard-panel--centered"
              >
                <Suspense fallback={<DashboardContentSkeleton />}>
                  <RadioPanel />
                </Suspense>
              </DashboardPanel>
            )}

            {activePage === 'appeal' && isSuspended && (
              <DashboardPanel title="Appeal suspension" description="You may submit one appeal per suspension" className="dashboard-panel--wide">
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
                {appealsError && (
                  <DashboardBanner
                    title="Could not load appeals"
                    message={appealsError}
                    actionLabel="Retry"
                    onAction={() => setAppealsRetry((value) => value + 1)}
                  />
                )}
                {isAppealsLoading ? (
                  <p>Loading appeals…</p>
                ) : staffAppeals.length === 0 ? (
                  !appealsError && <p>No pending appeals.</p>
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
                            {appealResolveErrors[appeal.id] && (
                              <p className="dashboard-page__error">{appealResolveErrors[appeal.id]}</p>
                            )}
                            <div className="dashboard-page__appeal-item__actions">
                              <Button
                                variant="primary"
                                onClick={() => void handleResolveStaffAppeal(appeal.id, 'lift')}
                                isLoading={resolvingAppealId === appeal.id}
                                disabled={resolvingAppealId !== null}
                              >
                                Remove punishment
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() => void handleResolveStaffAppeal(appeal.id, 'deny')}
                                disabled={resolvingAppealId !== null}
                              >
                                Deny
                              </Button>
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
