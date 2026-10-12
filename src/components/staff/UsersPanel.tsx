import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconChevronLeft, IconChevronRight, IconEdit, IconFilter, IconKey, IconSearch } from '@tabler/icons-react';
import { api } from '../../lib/api';
import type {
  PublicUser,
  StaffUserSubscriptionStatus,
  SubscriptionSource,
  SubscriptionTier,
  UserRole,
} from '../../../common';
import { BADGES, SUBSCRIPTION_TIERS } from '../../../common';
import { Button, Input, ManageSubscriptionsModal, PunishModal, Select, UsernameDisplay } from '../common';
import { SetPasswordModal } from './SetPasswordModal';
import { getBadgeIcon } from '../../lib/badges';
import './UsersPanel.css';

const PAGE_SIZE = 20;

function getTierName(tier: SubscriptionTier): string {
  return BADGES.find((badge) => badge.id === tier)?.name ?? tier;
}

const TIER_OPTIONS = [
  { value: '', label: 'Any subscription' },
  ...SUBSCRIPTION_TIERS.map((tier) => ({ value: tier, label: getTierName(tier) })),
];

const SOURCE_OPTIONS = [
  { value: '', label: 'Any source' },
  { value: 'paid', label: 'Paid' },
  { value: 'attached', label: 'Granted' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'Any status' },
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'none', label: 'No subscription' },
];

const ROLE_OPTIONS = [
  { value: '', label: 'Any role' },
  { value: 'user', label: 'User' },
  { value: 'staff', label: 'Staff' },
];

type Filters = {
  search: string;
  role: '' | UserRole;
  tier: '' | SubscriptionTier;
  source: '' | SubscriptionSource;
  status: '' | StaffUserSubscriptionStatus;
};

const EMPTY_FILTERS: Filters = { search: '', role: '', tier: '', source: '', status: '' };

type PagedUsers = {
  users: PublicUser[];
  total: number;
  totalPages: number;
};

export const UsersPanel = () => {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PagedUsers>({ users: [], total: 0, totalPages: 1 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [punishTarget, setPunishTarget] = useState<PublicUser | null>(null);
  const [subsTarget, setSubsTarget] = useState<PublicUser | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<PublicUser | null>(null);
  const [roleUpdating, setRoleUpdating] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(filters.search.trim());
    }, 300);

    return () => clearTimeout(handle);
  }, [filters.search]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await api.staff.listUsers({
          search: debouncedSearch || undefined,
          role: filters.role || undefined,
          tier: filters.tier || undefined,
          source: filters.source || undefined,
          status: filters.status || undefined,
          page,
          pageSize: PAGE_SIZE,
        });

        if (cancelled) return;
        setData({ users: result.users, total: result.total, totalPages: result.totalPages });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load users');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, filters.role, filters.tier, filters.source, filters.status, page, reloadToken]);

  const hasFilters = useMemo(
    () => Object.values(filters).some((value) => value !== ''),
    [filters],
  );

  const updateFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  const replaceUser = (updated: PublicUser) => {
    setData((current) => ({
      ...current,
      users: current.users.map((user) => (user.uuid === updated.uuid ? updated : user)),
    }));
  };

  const handleRoleChange = async (user: PublicUser, role: UserRole) => {
    if (role === user.role) return;

    setRoleUpdating(user.uuid);
    setError(null);

    try {
      const updated = await api.staff.updateRole(user.uuid, { role });
      replaceUser(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setRoleUpdating(null);
    }
  };

  return (
    <div className="users-panel">
      <div className="users-panel__filters">
        <Input
          className="users-panel__search"
          type="text"
          placeholder="Search by username or UUID..."
          value={filters.search}
          onChange={(event) => updateFilter('search', event.target.value)}
          aria-label="Search users"
        />
        <div className="users-panel__filter-row">
          <div className="users-panel__filter-icon" aria-hidden="true">
            <IconFilter size={16} />
          </div>
          <Select
            className="users-panel__filter"
            aria-label="Filter by role"
            value={filters.role}
            onChange={(event) => updateFilter('role', event.target.value as Filters['role'])}
            options={ROLE_OPTIONS}
          />
          <Select
            className="users-panel__filter"
            aria-label="Filter by subscription tier"
            value={filters.tier}
            onChange={(event) => updateFilter('tier', event.target.value as Filters['tier'])}
            options={TIER_OPTIONS}
          />
          <Select
            className="users-panel__filter"
            aria-label="Filter by subscription source"
            value={filters.source}
            onChange={(event) => updateFilter('source', event.target.value as Filters['source'])}
            options={SOURCE_OPTIONS}
          />
          <Select
            className="users-panel__filter"
            aria-label="Filter by subscription status"
            value={filters.status}
            onChange={(event) => updateFilter('status', event.target.value as Filters['status'])}
            options={STATUS_OPTIONS}
          />
          {hasFilters && (
            <Button variant="secondary" onClick={clearFilters} className="users-panel__clear">
              Clear
            </Button>
          )}
        </div>
      </div>

      {error && <div className="users-panel__error">{error}</div>}

      <div className="users-panel__summary">
        <span>
          {isLoading ? 'Loading users...' : `${data.total} user${data.total === 1 ? '' : 's'} found`}
        </span>
        <span className="users-panel__page-indicator">
          Page {page} of {data.totalPages}
        </span>
      </div>

      {isLoading ? (
        <p className="users-panel__hint">Loading...</p>
      ) : data.users.length === 0 ? (
        <p className="users-panel__hint">
          <IconSearch size={18} /> No users match your search.
        </p>
      ) : (
        <ul className="users-panel__list">
          {data.users.map((user) => (
            <li key={user.uuid} className="users-panel__item">
              <div className="users-panel__identity">
                <UsernameDisplay username={user.username} badges={user.badges} country={user.country} avatarUrl={user.avatarUrl} />
                <span className="users-panel__uuid">{user.uuid}</span>
                <div className="users-panel__meta">
                  <span className={`users-panel__roleTag users-panel__roleTag--${user.role}`}>
                    {user.role}
                  </span>
                  {user.subscription ? (
                    <span className="users-panel__subscription">
                      <span className="users-panel__subscriptionIcon">
                        {getBadgeIcon(user.subscription.tier)}
                      </span>
                      {getTierName(user.subscription.tier)}
                      <span className="users-panel__subscriptionSource">({user.subscription.source})</span>
                    </span>
                  ) : (
                    <span className="users-panel__subscription users-panel__subscription--none">
                      No active subscription
                    </span>
                  )}
                </div>
              </div>

              <div className="users-panel__actions">
                <Select
                  className="users-panel__roleSelect"
                  aria-label={`Role for ${user.username}`}
                  value={user.role}
                  onChange={(event) => handleRoleChange(user, event.target.value as UserRole)}
                  disabled={roleUpdating === user.uuid}
                  options={[
                    { value: 'user', label: 'User' },
                    { value: 'staff', label: 'Staff' },
                  ]}
                />
                <Button
                  variant="secondary"
                  onClick={() => navigate(`/dashboard/profile/${user.uuid}`)}
                >
                  <IconEdit size={16} /> Edit
                </Button>
                <Button variant="secondary" onClick={() => setSubsTarget(user)}>
                  Subscriptions
                </Button>
                <Button variant="secondary" onClick={() => setPasswordTarget(user)}>
                  <IconKey size={16} /> Password
                </Button>
                <Button variant="danger" onClick={() => setPunishTarget(user)}>
                  Punish
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="users-panel__pagination">
        <Button
          variant="secondary"
          onClick={() => setPage((current) => Math.max(1, current - 1))}
          disabled={page <= 1 || isLoading}
        >
          <IconChevronLeft size={16} /> Prev
        </Button>
        <span className="users-panel__page-indicator">
          {page} / {data.totalPages}
        </span>
        <Button
          variant="secondary"
          onClick={() => setPage((current) => Math.min(data.totalPages, current + 1))}
          disabled={page >= data.totalPages || isLoading}
        >
          Next <IconChevronRight size={16} />
        </Button>
      </div>

      {punishTarget && (
        <PunishModal
          isOpen={!!punishTarget}
          userUuid={punishTarget.uuid}
          username={punishTarget.username}
          onClose={() => setPunishTarget(null)}
          onPunish={() => {
            setPunishTarget(null);
            setReloadToken((token) => token + 1);
          }}
        />
      )}

      {subsTarget && (
        <ManageSubscriptionsModal
          isOpen={!!subsTarget}
          userUuid={subsTarget.uuid}
          username={subsTarget.username}
          onClose={() => setSubsTarget(null)}
          onChanged={(updated) => {
            if (updated) replaceUser(updated);
            setReloadToken((token) => token + 1);
          }}
        />
      )}

      {passwordTarget && (
        <SetPasswordModal
          isOpen={!!passwordTarget}
          userUuid={passwordTarget.uuid}
          username={passwordTarget.username}
          onClose={() => setPasswordTarget(null)}
          onChanged={(updated) => {
            if (updated) replaceUser(updated);
            setPasswordTarget(null);
          }}
        />
      )}
    </div>
  );
};

export default UsersPanel;
