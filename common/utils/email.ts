export const EMAIL_CODE_LENGTH = 6;
export const EMAIL_MAX_LENGTH = 254;

// Practical email validation: one "@", a non-empty local part and domain, and
// at least one dot in the domain. This is intentionally permissive so that
// legitimate addresses are not rejected; the server also normalizes the value.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getEmailValidationError(email: string): string | null {
  if (email.length === 0) return 'Email is required';
  if (email.length > EMAIL_MAX_LENGTH) return `Email must be ${EMAIL_MAX_LENGTH} characters or fewer`;
  if (!EMAIL_PATTERN.test(email)) return 'Enter a valid email address';
  return null;
}