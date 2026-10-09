import type { ReactNode } from 'react';

export type SettingsOptionType = 'button' | 'input' | 'checkbox' | 'select';

type SettingsOptionBase = {
  id: string;
  optionType: SettingsOptionType;
  title: string;
  description?: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
};

export type SettingsConfirm = {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  dangerous?: boolean;
};

export type ButtonSettingsOption = SettingsOptionBase & {
  optionType: 'button';
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
  confirm?: SettingsConfirm;
  action: () => void | Promise<void>;
};

export type InputSettingsOption = SettingsOptionBase & {
  optionType: 'input';
  value: string;
  placeholder?: string;
  inputType?: 'text' | 'email' | 'password' | 'number' | 'url';
  onChange: (value: string) => void;
};

export type CheckboxSettingsOption = SettingsOptionBase & {
  optionType: 'checkbox';
  checked: boolean;
  onChange: (checked: boolean) => void;
};

export type SelectSettingsOption = SettingsOptionBase & {
  optionType: 'select';
  value: string;
  options: readonly string[] | readonly { value: string; label: string }[];
  onChange: (value: string) => void;
};

export type SettingsOption =
  | ButtonSettingsOption
  | InputSettingsOption
  | CheckboxSettingsOption
  | SelectSettingsOption;

export type SettingsSection = {
  id: string;
  title?: string;
  description?: string;
  options: SettingsOption[];
};