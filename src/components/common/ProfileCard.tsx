import { useEffect, useRef, useState } from 'react';
import {
  IconBrandGithub,
  IconBrandBluesky,
  IconBrandReddit,
  IconBrandYoutube,
  IconBrandX,
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandTiktok,
  IconWorld,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { api } from '../../lib/api';
import { BioEditor, BioText, Button, UsernameDisplay, Avatar, Modal } from './index';
import { EmojiText } from './EmojiText';
import { countryCodeToFlag } from '@common/utils/country';
import { PunishModal } from './PunishModal';
import { ManageSubscriptionsModal } from './ManageSubscriptionsModal';
import { prepareAvatarFile, validateAvatarFile } from '../../lib/image';
import type { ProfileCountriesPayload, PublicUser, SocialLinkType, SocialLinks, UserRole } from '@common';
import { BIO_MAX_LENGTH, DEFAULT_BIO, Markdown } from '@common';
import {
  SOCIAL_LINK_LABELS,
  SOCIAL_LINK_HANDLE_HINTS,
  SOCIAL_LINK_TYPES,
  buildSocialLinkUrl,
  normalizeSocialHandle,
} from '@common/utils/social';
import './ProfileCard.css';

const SOCIAL_LINK_FIELDS: Array<{ key: SocialLinkType; label: string }> = SOCIAL_LINK_TYPES.map((key) => ({
  key,
  label: SOCIAL_LINK_LABELS[key],
}));

const SOCIAL_LINK_ICONS: Record<SocialLinkType, { label: string; icon: ReactNode }> = {
  website: { label: 'Website', icon: <IconWorld size={18} /> },
  youtube: { label: 'YouTube', icon: <IconBrandYoutube size={18} /> },
  github: { label: 'GitHub', icon: <IconBrandGithub size={18} /> },
  bluesky: { label: 'Bluesky', icon: <IconBrandBluesky size={18} /> },
  reddit: { label: 'Reddit', icon: <IconBrandReddit size={18} /> },
  x: { label: 'X', icon: <IconBrandX size={18} /> },
  facebook: { label: 'Facebook', icon: <IconBrandFacebook size={18} /> },
  instagram: { label: 'Instagram', icon: <IconBrandInstagram size={18} /> },
  tiktok: { label: 'TikTok', icon: <IconBrandTiktok size={18} /> },
};

function getInitialSocialLinkKey(links: SocialLinks): SocialLinkType {
  const first = Object.entries(links).find(([, value]) => typeof value === 'string' && value.trim().length > 0)?.[0];
  return (first as SocialLinkType) ?? 'website';
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function getRelativeTime(date: Date | string): string {
  const resolvedDate = toDate(date);
  const now = new Date();
  const diffMs = now.getTime() - resolvedDate.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffYears > 0) return `${diffYears} year${diffYears > 1 ? 's' : ''} ago`;
  if (diffMonths > 0) return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;
  if (diffDays >= 7) {
    const diffWeeks = Math.round(diffDays / 7);
    return `${diffWeeks} week${diffWeeks > 1 ? 's' : ''} ago`;
  }
  if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffMins > 0) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  return 'just now';
}

function formatDisplayDate(date: Date | string): string {
  return toDate(date).toLocaleDateString('en-GB');
}

export interface ProfileCardProps {
  userUuid: string;
  viewerUuid?: string;
  viewerRole?: UserRole;
  canEditProfile?: boolean;
  isPunishable?: boolean;
  onPunishSelf?: () => void;
}

export const ProfileCard: React.FC<ProfileCardProps> = ({
  userUuid,
  viewerUuid,
  viewerRole,
  canEditProfile = false,
  isPunishable = false,
  onPunishSelf,
}) => {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [countries, setCountries] = useState<ProfileCountriesPayload['countries']>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState('');
  const [bio, setBio] = useState('');
  const [socialLinks, setSocialLinks] = useState<SocialLinks>({});
  const [selectedSocialKey, setSelectedSocialKey] = useState<SocialLinkType>('website');
  const [selectedSocialValue, setSelectedSocialValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isUpdatingAvatar, setIsUpdatingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [isPunishModalOpen, setIsPunishModalOpen] = useState(false);
  const [isSubscriptionsModalOpen, setIsSubscriptionsModalOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [isDnsModalOpen, setIsDnsModalOpen] = useState(false);
  const [dnsChallenge, setDnsChallenge] = useState<any>(null);
  const [isDnsChecking, setIsDnsChecking] = useState(false);
  const [dnsError, setDnsError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const [userData, countryData] = await Promise.all([
          api.users.getByUuid(userUuid),
          api.profile.getCountries(),
        ]);
        setUser(userData.user);
        setCountries(countryData.countries);
        setSelectedCountry(userData.user.country ?? '');
        setBio(userData.user.bio ?? DEFAULT_BIO);
        const nextSocialLinks = userData.user.socialLinks ?? {};
        setSocialLinks(nextSocialLinks);
        const initialSocialKey = getInitialSocialLinkKey(nextSocialLinks);
        setSelectedSocialKey(initialSocialKey);
        setSelectedSocialValue(nextSocialLinks[initialSocialKey] ?? '');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load profile';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [userUuid, reloadToken]);

  const handleSaveProfile = async () => {
    if (!user) return;

    setIsSaving(true);
    setError(null);

    try {
      const updated = await api.profile.editUser(userUuid, {
        country: selectedCountry,
        bio: new Markdown(bio, canUseMarkdown).sanitize(),
        socialLinks,
      });
      setUser(updated);
      setIsEditingProfile(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update profile';
      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const openDnsModal = async () => {
    if (!user?.socialLinks?.website) return;
    setDnsError(null);
    setIsDnsChecking(true);
    try {
      const challenge = await api.profile.requestDomainChallenge({ type: 'website', domain: user.socialLinks.website });
      setDnsChallenge(challenge);
      setIsDnsModalOpen(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load DNS challenge';
      setError(message);
    } finally {
      setIsDnsChecking(false);
    }
  };

  const handleDnsCheck = async () => {
    if (!dnsChallenge) return;
    setIsDnsChecking(true);
    setDnsError(null);
    try {
      const domain = dnsChallenge.domain ?? dnsChallenge.value ?? user?.socialLinks?.website;
      const token = dnsChallenge.token ?? dnsChallenge.challenge ?? dnsChallenge.txtValue;
      const result = await api.profile.verifyDomain({ type: 'website', domain, token });
      setUser(result.user ?? result);
      setIsDnsModalOpen(false);
      setReloadToken((t) => t + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'TXT record not found or does not match';
      setDnsError(message);
    } finally {
      setIsDnsChecking(false);
    }
  };

  const handleAvatarFileChange = async (file: File | undefined) => {
    if (!user || !file) return;

    const validateError = validateAvatarFile(file);
    if (validateError) {
      setAvatarError(validateError);
      return;
    }

    setIsUpdatingAvatar(true);
    setAvatarError(null);

    try {
      const prepared = await prepareAvatarFile(file);
      const updated = await api.profile.uploadAvatar(prepared, userUuid);
      setUser(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upload avatar';
      setAvatarError(message);
    } finally {
      setIsUpdatingAvatar(false);
    }
  };

  const handleAvatarRemove = async () => {
    if (!user) return;

    setIsUpdatingAvatar(true);
    setAvatarError(null);

    try {
      const updated = await api.profile.removeAvatar(userUuid);
      setUser(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove avatar';
      setAvatarError(message);
    } finally {
      setIsUpdatingAvatar(false);
    }
  };

  const isStaff = viewerRole === 'staff';
  const isSelfProfile = viewerUuid === user?.uuid;
  const canEditThisProfile = canEditProfile || isSelfProfile || isStaff;
  const canPunishThisProfile = (isPunishable || isStaff) && !!user;
  const canUseMarkdown = isStaff;

  const invalidSocialLinkKey = SOCIAL_LINK_FIELDS.map(({ key }) => key).find((key) => {
    const handle = socialLinks[key];
    return typeof handle === 'string' && handle.trim().length > 0 && normalizeSocialHandle(key, handle) === null;
  });

  const socialHandleError = invalidSocialLinkKey
    ? `Enter a ${SOCIAL_LINK_LABELS[invalidSocialLinkKey]} handle, not a link`
    : null;

  const bioError = new Markdown(bio, canUseMarkdown).visibleLength() > BIO_MAX_LENGTH
    ? `Bio must be ${BIO_MAX_LENGTH} characters or fewer`
    : null;

  if (isLoading) {
    return <div className="profile-card profile-card--loading">Loading profile...</div>;
  }

  if (error || !user) {
    return <div className="profile-card profile-card--error">{error || 'Failed to load profile'}</div>;
  }

  const renderedSocialLinks = SOCIAL_LINK_FIELDS.flatMap(({ key }) => {
    const handle = user.socialLinks?.[key];
    if (!handle) return [];

    const href = buildSocialLinkUrl(key, handle);
    return href ? [{ key, label: SOCIAL_LINK_LABELS[key], href }] : [];
  });

  return (
    <div className="profile-card">
      <div className="profile-card__header">
        <div className="profile-card__identity">
          <UsernameDisplay username={user.username} badges={user.badges} country={user.country} avatarUrl={user.avatarUrl} avatarSize={56} />
        </div>
        <div className="profile-card__actions">
          {canEditThisProfile && !isEditingProfile && (
            <Button
              onClick={() => setIsEditingProfile(true)}
              variant="primary"
            >
              Edit Profile
            </Button>
          )}
          {canPunishThisProfile && !isEditingProfile && (
            <Button onClick={() => setIsPunishModalOpen(true)} variant="danger">
              Punish
            </Button>
          )}
          {isStaff && !isEditingProfile && (
            <Button onClick={() => setIsSubscriptionsModalOpen(true)} variant="secondary">
              Subscriptions
            </Button>
          )}
          {isEditingProfile && (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setIsEditingProfile(false);
                  setSelectedCountry(user.country ?? '');
                  setBio(user.bio ?? DEFAULT_BIO);
                  const nextSocialLinks = user.socialLinks ?? {};
                  setSocialLinks(nextSocialLinks);
                  const initialSocialKey = getInitialSocialLinkKey(nextSocialLinks);
                  setSelectedSocialKey(initialSocialKey);
                  setSelectedSocialValue(nextSocialLinks[initialSocialKey] ?? '');
                  setError(null);
                }}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleSaveProfile}
                isLoading={isSaving}
                disabled={isSaving || !!socialHandleError || !!bioError}
              >
                Save
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="profile-card__body">
        {!isEditingProfile ? (
          <>
            <div className="profile-card__bio">
              <BioText value={user.bio ?? DEFAULT_BIO} format={user.bioFormat} />
            </div>
            <div className="profile-card__meta">
              <p>
                Member since {getRelativeTime(user.createdAt)} ({formatDisplayDate(user.createdAt)})
              </p>
            </div>
            <div className="profile-card__footerRow">
              {user.country && (
                <div className="profile-card__country">
                  <EmojiText>
                    {countryCodeToFlag(user.country)
                      ? `${countryCodeToFlag(user.country)} ${countries.find((c) => c.code === user.country)?.name || 'Unknown'}`
                      : 'Not set'}
                  </EmojiText>
                </div>
              )}
              {renderedSocialLinks.length > 0 && (
                <div className="profile-card__socials" aria-label="Social links">
                  {renderedSocialLinks.map(({ key, label, href }) => (
                    <a
                      key={key}
                      className="profile-card__social-iconLink"
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={label}
                      title={label}
                    >
                      <span className="profile-card__social-icon">{SOCIAL_LINK_ICONS[key].icon}</span>
                    </a>
                  ))}
                </div>
              )}
              {renderedSocialLinks.some(({ key }) => key === 'website' && user.socialLinkVerified?.website === false) && (
                <div className="profile-card__form-error">
                  Website ownership unverified.{' '}
                  <Button type="button" onClick={() => void openDnsModal()} disabled={isDnsChecking} isLoading={isDnsChecking} variant="secondary">
                    Verify
                  </Button>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="profile-card__edit-form">
            <div className="profile-card__form-group profile-card__avatar-group">
              <label className="profile-card__form-label">Avatar</label>
              <div className="profile-card__avatar-row">
                <Avatar username={user.username} avatarUrl={user.avatarUrl} size={72} />
                <div className="profile-card__avatar-actions">
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="profile-card__avatar-input"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      void handleAvatarFileChange(file);
                    }}
                    disabled={isUpdatingAvatar}
                  />
                  <Button
                    variant="secondary"
                    onClick={() => avatarInputRef.current?.click()}
                    isLoading={isUpdatingAvatar}
                    disabled={isUpdatingAvatar}
                  >
                    Change photo
                  </Button>
                  {user.avatarUrl && (
                    <Button
                      variant="danger"
                      onClick={() => void handleAvatarRemove()}
                      disabled={isUpdatingAvatar}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
              {avatarError && <p className="profile-card__form-error">{avatarError}</p>}
            </div>

            <div className="profile-card__form-group">
              <label id="bio-label" htmlFor="bio" className="profile-card__form-label">
                Bio
              </label>
              <BioEditor
                id="bio"
                labelledBy="bio-label"
                value={bio}
                onChange={setBio}
                disabled={isSaving}
                maxLength={BIO_MAX_LENGTH}
                markdown={canUseMarkdown}
              />
              {bioError && <p className="profile-card__form-error">{bioError}</p>}
            </div>

            <div className="profile-card__socials-form">
              <div className="profile-card__socials-formHeader">
                <label className="profile-card__form-label">Social links</label>
                <button
                  type="button"
                  className="profile-card__socials-clearButton"
                  onClick={() => {
                    setSocialLinks({});
                    setSelectedSocialValue('');
                  }}
                  disabled={isSaving}
                >
                  Clear all
                </button>
              </div>

              <div className="profile-card__socialEditor">
                <div className="profile-card__socialPickerRow">
                  <select
                    className="profile-card__socialTypeSelect"
                    value={selectedSocialKey}
                    onChange={(event) => {
                      const nextKey = event.target.value as SocialLinkType;
                      setSelectedSocialKey(nextKey);
                      setSelectedSocialValue(socialLinks[nextKey] ?? '');
                    }}
                    disabled={isSaving}
                  >
                    {SOCIAL_LINK_FIELDS.map((field) => (
                      <option key={field.key} value={field.key}>
                        {field.label}
                      </option>
                    ))}
                  </select>

                  <input
                    className="profile-card__socialValueInput"
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={selectedSocialValue}
                    placeholder={SOCIAL_LINK_HANDLE_HINTS[selectedSocialKey]}
                    onChange={(event) => {
                      const value = event.target.value;
                      setSelectedSocialValue(value);
                      setSocialLinks((current) => ({
                        ...current,
                        [selectedSocialKey]: value,
                      }));
                    }}
                    disabled={isSaving}
                  />

                  <button
                    type="button"
                    className="profile-card__socialRemoveButton"
                    onClick={() => {
                      setSocialLinks((current) => {
                        const next = { ...current };
                        delete next[selectedSocialKey];
                        return next;
                      });
                      setSelectedSocialValue('');
                    }}
                    disabled={isSaving || !socialLinks[selectedSocialKey]}
                  >
                    Remove
                  </button>
                </div>

                {socialHandleError && (
                  <p className="profile-card__form-error">{socialHandleError}</p>
                )}

                <div className="profile-card__socialPreviewRow" aria-label="Saved social links">
                  {SOCIAL_LINK_FIELDS.map((field) => {
                    const value = socialLinks[field.key];
                    if (!value || !normalizeSocialHandle(field.key, value)) return null;

                    return (
                      <button
                        key={field.key}
                        type="button"
                        className={`profile-card__socialChip ${selectedSocialKey === field.key ? 'is-active' : ''}`}
                        onClick={() => {
                          setSelectedSocialKey(field.key);
                          setSelectedSocialValue(value);
                        }}
                        disabled={isSaving}
                      >
                        <span className="profile-card__socialChipIcon">{SOCIAL_LINK_ICONS[field.key].icon}</span>
                        <span>{field.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="profile-card__form-group">
              <label htmlFor="country-select" className="profile-card__form-label">
                Country
              </label>
              <select
                id="country-select"
                className="profile-card__form-select"
                value={selectedCountry}
                onChange={(event) => setSelectedCountry(event.target.value)}
                disabled={isSaving}
              >
                <option value="">Select a country</option>
                {countries.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.name}{countryCodeToFlag(country.code) ? ` ${countryCodeToFlag(country.code)}` : ''}
                  </option>
                ))}
              </select>
            </div>

            {error && <p className="profile-card__form-error">{error}</p>}
          </div>
        )}
      </div>

      {canPunishThisProfile && user && (
        <PunishModal
          isOpen={isPunishModalOpen}
          userUuid={user.uuid}
          username={user.username}
          onClose={() => setIsPunishModalOpen(false)}
          onPunish={() => setIsPunishModalOpen(false)}
          isSelfPunishment={viewerUuid === userUuid}
          onSelfPunishment={onPunishSelf}
        />
      )}

      {isStaff && user && (
        <ManageSubscriptionsModal
          isOpen={isSubscriptionsModalOpen}
          userUuid={user.uuid}
          username={user.username}
          onClose={() => setIsSubscriptionsModalOpen(false)}
          onChanged={() => setReloadToken((token) => token + 1)}
        />
      )}

      <Modal
        isOpen={isDnsModalOpen}
        onClose={() => setIsDnsModalOpen(false)}
        title="Verify website ownership"
        showCancel={true}
        cancelText="Close"
      >
        <div className="profile-card__form-group">
          <p>Add a TXT record to your DNS:</p>
          <p><strong>Name:</strong> {dnsChallenge?.recordName ?? dnsChallenge?.txtName ?? dnsChallenge?.name}</p>
          <p><strong>Value:</strong> {dnsChallenge?.recordValue ?? dnsChallenge?.txtValue ?? dnsChallenge?.value ?? dnsChallenge?.token}</p>
          <p>Then click Check.</p>
          {dnsError && <p className="profile-card__form-error">{dnsError}</p>}
          <Button onClick={() => void handleDnsCheck()} isLoading={isDnsChecking} disabled={isDnsChecking}>
            Check
          </Button>
        </div>
      </Modal>
    </div>
  );
};
