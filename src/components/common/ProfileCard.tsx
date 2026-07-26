import { useEffect, useState } from 'react';
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
import { Button, UsernameDisplay } from './index';
import { EmojiText } from './EmojiText';
import { countryCodeToFlag } from '../../../common/utils/country';
import { PunishModal } from './PunishModal';
import type { ProfileCountriesResponse, PublicUser, SocialLinkType, SocialLinks, UserRole } from '../../../common';
import './ProfileCard.css';

const SOCIAL_LINK_FIELDS: Array<{ key: SocialLinkType; label: string; placeholder: string }> = [
  { key: 'website', label: 'Website', placeholder: 'https://example.com' },
  { key: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/@username' },
  { key: 'github', label: 'GitHub', placeholder: 'https://github.com/username' },
  { key: 'bluesky', label: 'Bluesky', placeholder: 'https://bsky.app/profile/username.bsky.social' },
  { key: 'reddit', label: 'Reddit', placeholder: 'https://reddit.com/user/username' },
  { key: 'x', label: 'X', placeholder: 'https://x.com/username' },
  { key: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/username' },
  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/username' },
  { key: 'tiktok', label: 'TikTok', placeholder: 'https://tiktok.com/@username' },
];

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

function resolveSocialLinkUrl(value: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return value;
  }

  return `https://${value}`;
}

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
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffYears > 0) return `${diffYears} year${diffYears > 1 ? 's' : ''} ago`;
  if (diffMonths > 0) return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;
  if (diffWeeks > 0) return `${diffWeeks} week${diffWeeks > 1 ? 's' : ''} ago`;
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
  const [countries, setCountries] = useState<ProfileCountriesResponse['countries']>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState('');
  const [bio, setBio] = useState('');
  const [socialLinks, setSocialLinks] = useState<SocialLinks>({});
  const [selectedSocialKey, setSelectedSocialKey] = useState<SocialLinkType>('website');
  const [selectedSocialValue, setSelectedSocialValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isPunishModalOpen, setIsPunishModalOpen] = useState(false);

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
        setBio(userData.user.bio ?? "Hi! I'm a Ayphr user");
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
  }, [userUuid]);

  const handleSaveProfile = async () => {
    if (!user) return;

    setIsSaving(true);
    setError(null);

    try {
      const updated = await api.profile.editUser(userUuid, {
        country: selectedCountry,
        bio,
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

  const isStaffOrOwner = viewerRole === 'staff' || viewerRole === 'owner';
  const isSelfProfile = viewerUuid === user?.uuid;
  const canEditThisProfile = canEditProfile || isSelfProfile || isStaffOrOwner;
  const canPunishThisProfile = (isPunishable || isStaffOrOwner) && !!user && (user.role !== 'owner' || isSelfProfile);

  if (isLoading) {
    return <div className="profile-card profile-card--loading">Loading profile...</div>;
  }

  if (error || !user) {
    return <div className="profile-card profile-card--error">{error || 'Failed to load profile'}</div>;
  }

  return (
    <div className="profile-card">
      <div className="profile-card__header">
        <div className="profile-card__identity">
          <UsernameDisplay username={user.username} role={user.role} country={user.country} />
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
          {isEditingProfile && (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setIsEditingProfile(false);
                  setSelectedCountry(user.country ?? '');
                  setBio(user.bio ?? "Hi! I'm a Ayphr user");
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
                disabled={isSaving}
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
              <EmojiText>{user.bio ?? "Hi! I'm a Ayphr user"}</EmojiText>
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
              {user.socialLinks && Object.values(user.socialLinks).some(Boolean) && (
                <div className="profile-card__socials" aria-label="Social links">
                  {SOCIAL_LINK_FIELDS.map((field) => {
                    const value = user.socialLinks?.[field.key];
                    if (!value) return null;

                    return (
                      <a
                        key={field.key}
                        className="profile-card__social-iconLink"
                        href={resolveSocialLinkUrl(value)}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={field.label}
                        title={field.label}
                      >
                        <span className="profile-card__social-icon">{SOCIAL_LINK_ICONS[field.key].icon}</span>
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="profile-card__edit-form">
            <div className="profile-card__form-group">
              <label htmlFor="bio" className="profile-card__form-label">
                Bio
              </label>
              <textarea
                id="bio"
                className="profile-card__form-textarea"
                value={bio}
                onChange={(event) => setBio(event.target.value)}
                disabled={isSaving}
                placeholder="Tell people a little about yourself"
                rows={4}
              />
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
                    type="url"
                    value={selectedSocialValue}
                    placeholder={SOCIAL_LINK_FIELDS.find((field) => field.key === selectedSocialKey)?.placeholder}
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

                <div className="profile-card__socialPreviewRow" aria-label="Saved social links">
                  {SOCIAL_LINK_FIELDS.map((field) => {
                    const value = socialLinks[field.key];
                    if (!value) return null;

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
    </div>
  );
};
