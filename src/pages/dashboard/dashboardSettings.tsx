import { IconKeyboard, IconLayoutDashboard, IconLayoutSidebar, IconLock, IconLogout, IconLogout2, IconMail, IconShieldLock, IconSparkle2, IconTrash, IconUser } from '@tabler/icons-react';
import type { AssistantSendShortcut } from '../../components/common';
import type { SettingsSection } from '../../lib/settings';
import type { SelfUser , CreditBalance, AssistantVariant } from '@common';
import { ASSISTANT_DATA } from '@common';
import type { NavigateFunction } from 'react-router-dom';

export interface SettingsSectionsParams {
  user: SelfUser | null;
  credits: CreditBalance | null;
  defaultTab: string;
  setDefaultTabPref: (value: string) => void;
  sidebarPinned: boolean;
  setSidebarPinnedPref: (checked: boolean) => void;
  assistantVariant: AssistantVariant;
  setAssistantVariantPref: (value: AssistantVariant) => void;
  availableAssistantVariants: readonly AssistantVariant[];
  assistantSendShortcut: AssistantSendShortcut;
  setAssistantSendShortcutPref: (value: AssistantSendShortcut) => void;
  isStaff: boolean;
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
    setDefaultTabPref,
    sidebarPinned,
    setSidebarPinnedPref,
    assistantVariant,
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
  } = params;

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
          description: 'Choose which tab opens when you visit the dashboard.',
          value: defaultTab,
          options: [
            { value: 'overview', label: 'Overview' },
            { value: 'devices', label: 'Devices' },
            { value: 'locations', label: 'Locations' },
            { value: 'profile', label: 'Profile' },
            { value: 'credits', label: 'Credits' },
            { value: 'games', label: 'Games' },
            { value: 'team', label: 'Team' },
            ...(isStaff ? [{ value: 'users', label: 'Users' }] : []),
          ],
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
  ];
}
