import type { SocialLinkType } from '../types';

export const SOCIAL_LINK_TYPES = [
  'website',
  'youtube',
  'github',
  'bluesky',
  'reddit',
  'x',
  'facebook',
  'instagram',
  'tiktok',
] as const;

export const SOCIAL_LINK_LABELS: Record<SocialLinkType, string> = {
  website: 'Website',
  youtube: 'YouTube',
  github: 'GitHub',
  bluesky: 'Bluesky',
  reddit: 'Reddit',
  x: 'X',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
};

export const SOCIAL_LINK_HANDLE_HINTS: Record<SocialLinkType, string> = {
  website: 'example.com',
  youtube: 'username',
  github: 'username',
  bluesky: 'alice.bsky.social',
  reddit: 'username',
  x: 'username',
  facebook: 'username',
  instagram: 'username',
  tiktok: 'username',
};

type SocialUrlTemplate = {
  prefix: string;
  suffix: string;
};

const SOCIAL_URL_TEMPLATES: Record<SocialLinkType, SocialUrlTemplate> = {
  website: { prefix: 'https://', suffix: '' },
  youtube: { prefix: 'https://youtube.com/@', suffix: '' },
  github: { prefix: 'https://github.com/', suffix: '' },
  bluesky: { prefix: 'https://bsky.app/profile/', suffix: '' },
  reddit: { prefix: 'https://reddit.com/user/', suffix: '' },
  x: { prefix: 'https://x.com/', suffix: '' },
  facebook: { prefix: 'https://facebook.com/', suffix: '' },
  instagram: { prefix: 'https://instagram.com/', suffix: '' },
  tiktok: { prefix: 'https://tiktok.com/@', suffix: '' },
};

const MAX_HANDLE_LENGTH = 64;
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const DOMAIN_TLD_PATTERN = /\.[a-z]{2,}$/;
const HANDLE_PATTERN = /^[a-zA-Z0-9._-]+$/;

export function isSocialLinkType(value: string): value is SocialLinkType {
  return (SOCIAL_LINK_TYPES as readonly string[]).includes(value);
}

function stripDecorations(value: string): string {
  return value.startsWith('@') ? value.slice(1).trim() : value.trim();
}

/**
 * Social links are stored as bare platform handles, never as URLs. Returns the
 * normalized handle, or null when the input is not a valid handle for the type.
 */
export function normalizeSocialHandle(type: SocialLinkType, value: string): string | null {
  const handle = stripDecorations(value);

  if (!handle || handle.length > MAX_HANDLE_LENGTH) {
    return null;
  }

  // Websites and Bluesky handles are both real domains.
  if (type === 'website' || type === 'bluesky') {
    const lower = handle.toLowerCase();

    // A Bluesky handle with no dot cannot be a custom domain, so it can only be
    // the default one. Anything containing a dot is kept exactly as typed, which
    // is what makes custom domains work.
    const domain = type === 'bluesky' && !lower.includes('.') ? `${lower}.bsky.social` : lower;

    return DOMAIN_PATTERN.test(domain) && DOMAIN_TLD_PATTERN.test(domain) ? domain : null;
  }

  if (!HANDLE_PATTERN.test(handle)) {
    return null;
  }

  if (handle.startsWith('.') || handle.endsWith('.')) {
    return null;
  }

  return handle;
}

/**
 * Builds the outbound link for a stored handle. Because the handle charset is
 * restricted, the result can never deviate from the platform template.
 */
export function buildSocialLinkUrl(type: SocialLinkType, handle: string): string | null {
  const normalized = normalizeSocialHandle(type, handle);

  if (!normalized) {
    return null;
  }

  const { prefix, suffix } = SOCIAL_URL_TEMPLATES[type];
  return `${prefix}${normalized}${suffix}`;
}
