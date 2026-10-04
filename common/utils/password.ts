export const PASSWORD_MIN_LENGTH = 12;

export type PasswordValidationChecks = {
  minLength: boolean;
  lowercase: boolean;
  uppercase: boolean;
  number: boolean;
  symbol: boolean;
};

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
