export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordValidationChecks = {
  minLength: boolean;
  lowercase: boolean;
  uppercase: boolean;
  number: boolean;
  symbol: boolean;
};

/** Single source of truth for the password requirements shown in the UI. */
export const PASSWORD_RULES: ReadonlyArray<{ key: keyof PasswordValidationChecks; label: string }> = [
  { key: 'minLength', label: `At least ${PASSWORD_MIN_LENGTH} characters` },
  { key: 'lowercase', label: 'At least one lowercase letter' },
  { key: 'uppercase', label: 'At least one uppercase letter' },
  { key: 'number', label: 'At least one number' },
  { key: 'symbol', label: 'At least one special character' },
];

export function getPasswordValidationChecks(password: string): PasswordValidationChecks {
  return {
    minLength: password.length >= PASSWORD_MIN_LENGTH,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };
}

export function getPasswordValidationErrors(password: string): string[] {
  const checks = getPasswordValidationChecks(password);
  const errors: string[] = [];

  if (!checks.minLength) {
    errors.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    errors.push(`Password must be at most ${PASSWORD_MAX_LENGTH} characters`);
  }
  if (!checks.lowercase) {
    errors.push('Password must include at least one lowercase letter');
  }
  if (!checks.uppercase) {
    errors.push('Password must include at least one uppercase letter');
  }
  if (!checks.number) {
    errors.push('Password must include at least one number');
  }
  if (!checks.symbol) {
    errors.push('Password must include at least one special character');
  }

  return errors;
}
