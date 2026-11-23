import { IconBell, IconKeyboard, IconLayoutDashboard, IconLayoutSidebar, IconLock, IconLogout, IconLogout2, IconMail, IconShieldLock, IconSparkle2, IconTrash, IconUser } from '@tabler/icons-react';
import type { AssistantSendShortcut } from '../../components/common';
import type { SettingsSection } from '../../lib/settings';
import type { DashboardTab } from '../../lib/dashboardRoutes';
import type { SelfUser , CreditBalance, AssistantVariant } from '@common';
import { ASSISTANT_DATA } from '@common';
import type { NavigateFunction } from 'react-router-dom';

const DEFAULT_TAB_OPTIONS: { value: DashboardTab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'devices', label: 'Devices' },
  { value: 'locations', label: 'Locations' },
  { value: 'profile', label: 'Profile' },
  { value: 'credits', label: 'Credits' },
  { value: 'games', label: 'Games' },
  { value: 'radio', label: 'Radio' },
  { value: 'team', label: 'Team' },
  { value: 'users', label: 'Users' },
];

export interface SettingsSectionsParams {
  user: SelfUser | null;
  credits: CreditBalance | null;
  defaultTab: string;
  effectiveDefaultTab: string;
  setDefaultTabPref: (value: string) => void;
  sidebarPinned: boolean;
  setSidebarPinnedPref: (checked: boolean) => void;
  assistantVariant: AssistantVariant;
  setAssistantVariantPref: (value: AssistantVariant) => void;
  availableAssistantVariants: readonly AssistantVariant[];
  assistantSendShortcut: AssistantSendShortcut;
  setAssistantSendShortcutPref: (value: AssistantSendShortcut) => void;
  chatRetentionDays: number;
  setChatRetentionDaysPref: (value: number) => void;
  piiRedactionEnabled: boolean;
  setPiiRedactionPref: (value: boolean) => void;
  isStaff: boolean;
  isTeamMember: boolean;
  now: number;
  navigate: NavigateFunction;
  setIsSessionsOpen: (open: boolean) => void;
  setIsChangePasswordOpen: (open: boolean) => void;
  setIsChangeEmailOpen: (open: boolean) => void;
  setIsChangeUsernameOpen: (open: boolean) => void;
}

export function buildSettingsSections(params: SettingsSectionsParams): SettingsSection[] {
  const {
    user,
    defaultTab,
    effectiveDefaultTab,
    setDefaultTabPref,
    sidebarPinned,
    setSidebarPinnedPref,
    assistantVariant,
    setAssistantVariantPref,
    availableAssistantVariants,
    assistantSendShortcut,
    setAssistantSendShortcutPref,
    chatRetentionDays,
    setChatRetentionDaysPref,
    piiRedactionEnabled,
    setPiiRedactionPref,
    isStaff,
    isTeamMember,
    now,
    navigate,
    setIsSessionsOpen,
    setIsChangePasswordOpen,
    setIsChangeEmailOpen,
    setIsChangeUsernameOpen,
  } = params;

  const availableDefaultTabs = DEFAULT_TAB_OPTIONS.filter(
    (option) => (option.value !== 'team' || isTeamMember) && (option.value !== 'users' || isStaff),
  );
  const effectiveDefaultLabel = availableDefaultTabs.find((option) => option.value === effectiveDefaultTab)?.label ?? 'Overview';
  const savedDefaultLabel = DEFAULT_TAB_OPTIONS.find((option) => option.value === defaultTab)?.label ?? defaultTab;
  const defaultTabDescription = effectiveDefaultTab === defaultTab
    ? `Choose which tab opens when you visit the dashboard. Currently: ${effectiveDefaultLabel}.`
    : `Choose which tab opens when you visit the dashboard. Saved view (${savedDefaultLabel}) is unavailable; currently: ${effectiveDefaultLabel}.`;

  return [
    {
      id: 'account',
      title: 'Account',
      options: [
        {
          id: 'username',
          optionType: 'button',
          icon: <IconUser size={18} strokeWidth={1.75} />,
          title: 'Username',
          description: (() => {
            if (user?.role === 'staff') {
              return `Current: ${user?.username}. Staff can change their username at any time.`;
            }
            const changedAt = user?.usernameChangedAt ? new Date(user.usernameChangedAt) : null;
            const nextAllowed = changedAt ? new Date(changedAt.getTime() + 29 * 24 * 60 * 60 * 1000) : null;
            if (nextAllowed && now < nextAllowed.getTime()) {
              return `Current: ${user?.username}. You can change again on ${nextAllowed.toLocaleDateString('en-GB')}.`;
            }
            return `Current: ${user?.username}. You can change your username once every 29 days.`;
          })(),
          label: 'Change username',
          variant: 'secondary',
          disabled: (() => {
            if (user?.role === 'staff') return false;
            const changedAt = user?.usernameChangedAt ? new Date(user.usernameChangedAt) : null;
            const nextAllowed = changedAt ? new Date(changedAt.getTime() + 29 * 24 * 60 * 60 * 1000) : null;
            return Boolean(nextAllowed && now < nextAllowed.getTime());
          })(),
          action: () => setIsChangeUsernameOpen(true),
        },
        {
          id: 'email',
          optionType: 'button',
          icon: <IconMail size={18} strokeWidth={1.75} />,
          title: 'Email',
          description: user?.email
            ? `${user.email}${user.emailVerifiedAt ? ` (verified ${new Date(user.emailVerifiedAt).toLocaleDateString('en-GB')})` : ''}`
            : 'Add a verified email address to secure your account.',
          label: user?.email ? 'Change email' : 'Set email',
          variant: 'secondary',
          action: () => setIsChangeEmailOpen(true),
        },
        {
          id: 'logout',
          optionType: 'button',
          icon: <IconLogout size={18} strokeWidth={1.75} />,
          title: 'Log out',
          description: 'Sign out of your account on this device.',
          label: 'Log out',
          variant: 'secondary',
          action: async () => {
            await (await import('../../lib/api')).api.auth.logout();
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
            await (await import('../../lib/api')).api.auth.logoutOthers();
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
            await (await import('../../lib/api')).api.auth.logoutAll();
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
            await (await import('../../lib/api')).api.auth.deleteAccount({ password: password ?? '' });
            await navigate('/auth', { replace: true });
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
          description: defaultTabDescription,
          value: effectiveDefaultTab,
          options: availableDefaultTabs,
          onChange: setDefaultTabPref,
        },
        {
          id: 'sidebar-pinned',
          optionType: 'checkbox',
          icon: <IconLayoutSidebar size={18} strokeWidth={1.75} />,
          title: 'Keep sidebar open',
          description: 'Always show the full sidebar instead of collapsing it to icons.',
          checked: sidebarPinned,
          onChange: setSidebarPinnedPref,
        },
        {
          id: 'notification-preferences',
          optionType: 'button',
          icon: <IconBell size={18} strokeWidth={1.75} />,
          title: 'Notifications',
          description: 'Choose which notifications you receive in the app, by email, and in your browser.',
          label: 'Notification preferences',
          variant: 'secondary',
          action: () => navigate('/dashboard/notifications'),
        },
      ],
    },
    {
      id: 'iris',
      title: 'Iris',
      options: [
        {
          id: 'default-assistant-variant',
          optionType: 'select',
          icon: <IconSparkle2 size={18} strokeWidth={1.75} />,
          title: 'Default assistant variant',
          description: 'Choose which Iris variant is selected when you open the assistant.',
          value: assistantVariant,
          options: availableAssistantVariants.map((variant) => ({
            value: variant,
            label: ASSISTANT_DATA[variant].variantLabel,
          })),
          onChange: (value) => setAssistantVariantPref(value as AssistantVariant),
        },
        {
          id: 'assistant-send-shortcut',
          optionType: 'select',
          icon: <IconKeyboard size={18} strokeWidth={1.75} />,
          title: 'Send messages with',
          description: 'Choose which key combination sends a message. The other adds a new line.',
          value: assistantSendShortcut,
          options: [
            { value: 'enter', label: 'Enter' },
            { value: 'shift-enter', label: 'Shift + Enter' },
          ],
          onChange: (value) => setAssistantSendShortcutPref(value as AssistantSendShortcut),
        },
      ],
    },
    {
      id: 'privacy',
      title: 'Privacy',
      options: [
        {
          id: 'chat-retention',
          optionType: 'select',
          icon: <IconShieldLock size={18} strokeWidth={1.75} />,
          title: 'Chat retention',
          description: 'Automatically remove chats older than the selected period. 0 keeps everything.',
          value: String(chatRetentionDays),
          options: [
            { value: '0', label: 'Keep all' },
            { value: '7', label: '7 days' },
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
          ],
          onChange: (value) => setChatRetentionDaysPref(Number(value)),
        },
        {
          id: 'pii-redaction',
          optionType: 'checkbox',
          icon: <IconLock size={18} strokeWidth={1.75} />,
          title: 'PII redaction',
          description: 'Redact emails, phone numbers, and other personal data from stored messages and logs.',
          checked: piiRedactionEnabled,
          onChange: (checked) => setPiiRedactionPref(checked),
        },
      ],
    },
  ];
}
