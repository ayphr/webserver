export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;

const USERNAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/;

export function getUsernameValidationError(username: string): string | null {
  if (username.length < USERNAME_MIN_LENGTH) {
    return `Username must be at least ${USERNAME_MIN_LENGTH} characters`;
  }

  if (username.length > USERNAME_MAX_LENGTH) {
    return `Username must be ${USERNAME_MAX_LENGTH} characters or fewer`;
  }

  if (!USERNAME_PATTERN.test(username)) {
    return 'Username may only contain letters, numbers, dots, underscores, and hyphens';
  }

  return null;
}
