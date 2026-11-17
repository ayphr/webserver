import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button, Input, Modal, Select, ProgressBar, Tooltip } from '../common';
import { IconUserPlus, IconEdit, IconCoin, IconDeviceDesktop, IconMapPin, IconDatabase, IconPlus, IconExternalLink } from '@tabler/icons-react';
import type { Team, TeamMember, TeamRole, TeamInvite, CreditBalance, SubscriptionTier, SubscriptionPlan, BillingInterval, TeamSubscriptionPayload } from '@common';
import { PLAN_NAMES } from '@common';
import { getPlanFeatures } from '@common/utils/plans';
import { TeamAuditPanel } from './TeamAuditPanel';
import './TeamPanel.css';

const ROLE_OPTIONS = [
  { value: 'member', label: 'Member' },
  { value: 'helper', label: 'Helper' },
  { value: 'manager', label: 'Manager' },
];

const PAID_TIERS: SubscriptionTier[] = ['lite', 'plus', 'ultra', 'team-lite', 'team-plus', 'team-ultra'];
const TEAM_LIMIT = 3;

const INTERVAL_OPTIONS = [
  { value: 'month', label: 'Monthly' },
  { value: 'year', label: 'Yearly' },
];

function formatPlanPrice(plan: SubscriptionPlan): string {
  if (plan.amount == null) return 'Pricing unavailable';
  const amount = plan.amount / 100;
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: plan.currency ?? 'usd',
    maximumFractionDigits: 0,
  }).format(amount);
}

type TeamPanelProps = {
  isManager?: boolean;
  userUuid?: string;
};

type TeamTab = 'members' | 'usage' | 'audit' | 'settings';

export function TeamPanel({ isManager = false, userUuid }: TeamPanelProps) {
  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [editRole, setEditRole] = useState<TeamRole>('member');
  const [identifier, setIdentifier] = useState('');
  const [role, setRole] = useState<TeamRole>('member');
  const [activeTab, setActiveTab] = useState<TeamTab>('members');
  const [teamName, setTeamName] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const [usageCredits, setUsageCredits] = useState<CreditBalance | null>(null);
  const [usageDevices, setUsageDevices] = useState<{ count: number; dataPoints: number }>({ count: 0, dataPoints: 0 });
  const [usageLocations, setUsageLocations] = useState(0);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSuccess, setNameSuccess] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [subscription, setSubscription] = useState<TeamSubscriptionPayload | null>(null);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>('month');
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [checkoutTier, setCheckoutTier] = useState<SubscriptionTier | null>(null);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const [showFreePlan, setShowFreePlan] = useState(false);
  const [confirmation, setConfirmation] = useState<{ title: string; message: string; action: () => void } | null>(null);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.teams.me();
      setTeam(data.team);
      setMembers(data.members);
      setTeamName(data.team.name ?? '');
      try {
        setInvites(await api.teams.listInvites());
      } catch {
        setInvites([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load team');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [list, me] = await Promise.all([api.teams.listMine(), api.teams.me()]);
        if (cancelled) return;
        setTeams(list);
        setActiveTeamId(me.team.id);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeTab !== 'settings' || !team || team.managerUuid !== userUuid) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.teams.subscription();
        if (cancelled) return;
        setSubscription(data);
        setSubscriptionError(null);
      } catch (err) {
        if (cancelled) return;
        setSubscriptionError(err instanceof Error ? err.message : 'Failed to load plans');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, team?.id, team?.managerUuid, userUuid]);

  useEffect(() => {
    if (activeTab !== 'usage') return;
    let cancelled = false;
    (async () => {
      try {
        const credits = await api.credits.me();
        const devices = await api.devices.listMine();
        const locations = await api.locations.listMine();
        if (cancelled) return;
        setUsageCredits(credits);
        setUsageDevices({
          count: devices.length,
          dataPoints: devices.reduce((sum, d) => sum + (d.dataPointCount ?? 0), 0),
        });
        setUsageLocations(locations.length);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  const handleInvite = async () => {
    const value = identifier.trim();
    if (!value) return;
    setError(null);
    const isEmail = value.includes('@');
    try {
      await api.teams.addMember({
        username: isEmail ? undefined : value,
        email: isEmail ? value : undefined,
        role,
      });
      setIdentifier('');
      setRole('member');
      setIsInviteOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite member');
    }
  };

  const handleEditSave = async () => {
    if (!editingMember) return;
    try {
      await api.teams.updateRole(editingMember.uuid, { role: editRole });
      setEditingMember(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role');
    }
  };

  const handleEditRemove = async () => {
    if (!editingMember) return;
    try {
      await api.teams.removeMember(editingMember.uuid);
      setEditingMember(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
    }
  };

  const handleDeleteTeam = async () => {
    if (!team) return;
    try {
      await api.teams.deleteTeam();
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete team');
    }
  };

  const handleLeaveTeam = async () => {
    if (!team) return;
    try {
      await api.teams.removeMember(userUuid ?? '');
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to leave team');
    }
  };

  const handleRevokeInvite = async (id: string) => {
    try {
      await api.teams.revokeInvite(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke invite');
    }
  };

  const handleSaveName = async () => {
    const value = teamName.trim();
    if (!value) {
      setNameError('Name is required');
      return;
    }
    setIsSavingName(true);
    setNameError(null);
    setNameSuccess(null);
    try {
      const updated = await api.teams.updateTeam({ name: value });
      setTeam(updated);
      setTeamName(updated.name ?? value);
      setNameSuccess('Team name updated.');
    } catch (err) {
      setNameError(err instanceof Error ? err.message : 'Failed to update team name');
    } finally {
      setIsSavingName(false);
    }
  };

  const handleCreateTeam = async () => {
    setIsCreating(true);
    setError(null);
    try {
      const created = await api.teams.createTeam(newTeamName.trim() || undefined);
      setTeams((current) => [...current, created]);
      setActiveTeamId(created.id);
      setIsCreateOpen(false);
      setNewTeamName('');
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create team');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCheckout = async (tier: SubscriptionTier) => {
    const features = getPlanFeatures(tier);
    if (features.maxUsers < members.length) {
      setConfirmation({
        title: 'Reduce team size?',
        message: `This plan allows ${features.maxUsers} member${features.maxUsers === 1 ? '' : 's'}, but this team has ${members.length}. Members over the limit will be removed. Continue?`,
        action: () => void handleCheckoutConfirmed(tier),
      });
      return;
    }
    await handleCheckoutConfirmed(tier);
  };

  const handleCheckoutConfirmed = async (tier: SubscriptionTier) => {
    setCheckoutTier(tier);
    setSubscriptionError(null);
    try {
      const url = await api.teams.subscriptionCheckout(tier, billingInterval);
      window.location.assign(url);
    } catch (err) {
      setSubscriptionError(err instanceof Error ? err.message : 'Failed to start checkout');
      setCheckoutTier(null);
    }
  };

  const handleFreePlan = async () => {
    if (members.length > 1) {
      setConfirmation({ title: 'Reduce team size?', message: `The Free plan allows 1 member, but this team has ${members.length}. Members over the limit will be removed. Continue?`, action: () => void handleFreePlanConfirmed() });
      return;
    }
    await handleFreePlanConfirmed();
  };

  const handleFreePlanConfirmed = async () => {
    setSubscriptionError(null);
    try {
      await api.teams.setFreePlan();
      window.location.reload();
    } catch (err) {
      setSubscriptionError(err instanceof Error ? err.message : 'Failed to change plan');
    }
  };

  const handlePortal = async () => {
    setIsOpeningPortal(true);
    setSubscriptionError(null);
    try {
      const url = await api.teams.subscriptionPortal();
      window.location.assign(url);
    } catch (err) {
      setSubscriptionError(err instanceof Error ? err.message : 'Failed to open billing portal');
    } finally {
      setIsOpeningPortal(false);
    }
  };

  if (isLoading) return <p className="team-panel__loading">Loading team…</p>;
  if (error) return <p className="team-panel__error">{error}</p>;
  if (!team) return <p className="team-panel__empty">No team found. A team plan is required.</p>;

  const isTeamManager = !!userUuid && team?.managerUuid === userUuid;
  const configuredPlans = subscription?.plans.filter((plan) => plan.interval === billingInterval) ?? [];
  const teamPlans: SubscriptionPlan[] = configuredPlans.length > 0
    ? configuredPlans
    : PAID_TIERS.map((tier) => ({
        tier,
        interval: billingInterval,
        priceId: null,
        amount: null,
        currency: null,
        trialDays: subscription?.trialDays ?? 0,
      }));

  const tabs: { id: TeamTab; label: string }[] = [
    { id: 'members', label: 'Members' },
    { id: 'usage', label: 'Usage' },
    ...(isManager ? [{ id: 'audit' as TeamTab, label: 'Audit' }, { id: 'settings' as TeamTab, label: 'Settings' }] : []),
  ];

  return (
    <div className="team-panel">
      {teams.length > 0 && (
        <div className="team-panel__switcher">
          <div className="team-panel__switcher-field">
            <Select
              label="Switch team"
              value={activeTeamId ?? team.id}
              onChange={(event) => {
                const id = event.target.value;
                setActiveTeamId(id);
                void api.teams.switchTeam(id).then(() => window.location.reload());
              }}
              options={teams.map((item) => ({ value: item.id, label: item.name ?? 'Team' }))}
              fullWidth
            />
          </div>
          <span className="team-panel__team-count">{teams.length}/{TEAM_LIMIT}</span>
          {teams.length >= TEAM_LIMIT ? (
            <Tooltip content="You can be a member of up to 3 teams">
              <Button variant="secondary" disabled>
                <IconPlus size={16} />
                New team
              </Button>
            </Tooltip>
          ) : (
            <Button variant="secondary" onClick={() => setIsCreateOpen(true)}>
              <IconPlus size={16} />
              New team
            </Button>
          )}
        </div>
      )}
      <header className="team-panel__header">
        <h3 className="team-panel__title">{team.name ?? 'Team'}</h3>
        {activeTab === 'members' && (
          <Button variant="secondary" onClick={() => setIsInviteOpen(true)}>
            <IconUserPlus size={16} />
            Invite member
          </Button>
        )}
      </header>

      <div className="settings__tabs" role="tablist" aria-label="Team sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`settings__tab ${activeTab === tab.id ? 'settings__tab--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'members' && (
        <>
          <section className="team-panel__section team-panel__section--plain">
            <h4 className="team-panel__section-title">Members</h4>
            <ul className="team-panel__list team-panel__list--plain">
              {members.map((m) => {
                const isPayingManager = team !== null && m.uuid === team.managerUuid;
                return (
                <li key={m.uuid} className="team-panel__member-row">
                  <div className="team-panel__member-info">
                    <span className="team-panel__member-name">{m.username}</span>
                    <span className="team-panel__member-role">{isPayingManager ? 'Team Manager' : m.role}</span>
                  </div>
                  {!isPayingManager && isTeamManager && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setEditingMember(m);
                      setEditRole(m.role);
                    }}
                  >
                    <IconEdit size={16} />
                    Edit
                  </Button>
                  )}
                </li>
                );
              })}
            </ul>
          </section>

          {invites.length > 0 && (
            <section className="team-panel__section">
              <h4 className="team-panel__section-title">Pending invites</h4>
              <ul className="team-panel__list team-panel__list--plain">
                {invites.map((invite) => (
                  <li key={invite.id} className="team-panel__member-row">
                    <div className="team-panel__member-info">
                      <span className="team-panel__member-name">{invite.email}</span>
                      <span className="team-panel__member-role">{invite.role}</span>
                    </div>
                    {isManager && (
                      <Button variant="secondary" onClick={() => handleRevokeInvite(invite.id)}>
                        Revoke
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {activeTab === 'usage' && (
        <div className="team-panel__usage-list">
          {(() => {
            const seats = Math.max(1, members.length);
            const features = getPlanFeatures(team.tier, seats);
            const items = [
              {
                icon: <IconCoin size={20} />,
                label: 'Monthly credits',
                value: usageCredits ? `${usageCredits.monthlyUsed.toLocaleString()} / ${usageCredits.monthlyAllowance.toLocaleString()}` : '—',
                used: usageCredits ? usageCredits.monthlyUsed : 0,
                max: usageCredits ? usageCredits.monthlyAllowance || 1 : 1,
              },
              {
                icon: <IconCoin size={20} />,
                label: 'Additional credits',
                value: usageCredits ? `${usageCredits.additional.toLocaleString()} / ${usageCredits.additionalLimit.toLocaleString()}` : '—',
                used: usageCredits ? usageCredits.additional : 0,
                max: usageCredits ? usageCredits.additionalLimit || 1 : 1,
              },
              {
                icon: <IconDeviceDesktop size={20} />,
                label: 'Devices',
                value: `${usageDevices.count} / ${features.maxDevices}`,
                used: usageDevices.count,
                max: features.maxDevices,
              },
              {
                icon: <IconMapPin size={20} />,
                label: 'Locations',
                value: `${usageLocations} / ${features.maxLocations}`,
                used: usageLocations,
                max: features.maxLocations,
              },
              {
                icon: <IconDatabase size={20} />,
                label: 'Data points',
                value: `${usageDevices.dataPoints.toLocaleString()} / ${features.sharedMaxDataPointsPerUser.toLocaleString()}`,
                used: usageDevices.dataPoints,
                max: features.sharedMaxDataPointsPerUser,
              },
            ];
            return items.map((item) => (
              <div key={item.label} className="team-panel__usage-row-modern">
                <div className="team-panel__usage-row-modern__top">
                  <div className="team-panel__usage-row-modern__left">
                    <span className="team-panel__usage-row-modern__icon">{item.icon}</span>
                    <span className="team-panel__usage-row-modern__label">{item.label}</span>
                  </div>
                  <span className="team-panel__usage-row-modern__value">{item.value}</span>
                </div>
                <ProgressBar value={item.used} max={item.max} />
              </div>
            ));
          })()}
        </div>
      )}

      {activeTab === 'audit' && isManager && (
        <TeamAuditPanel />
      )}

      {activeTab === 'settings' && isManager && (
        <>
          <section className="team-panel__section">
            <h4 className="team-panel__section-title">Team name</h4>
            <div className="team-panel__invite-form">
              <Input
                label="Name"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                fullWidth
              />
              {nameError && <p className="team-panel__error">{nameError}</p>}
              {nameSuccess && <p className="team-panel__loading">{nameSuccess}</p>}
              <div className="team-panel__edit-actions">
                <Button onClick={() => void handleSaveName()} isLoading={isSavingName} disabled={isSavingName}>
                  Save
                </Button>
              </div>
            </div>
          </section>

          <section className="team-panel__section team-panel__subscription">
            <div className="team-panel__subscription-head">
              <div>
                <h4 className="team-panel__section-title">Subscription</h4>
                <p className="team-panel__subscription-current">
                  Current plan: <strong>{PLAN_NAMES[team.tier]}</strong>
                  {subscription?.team.subscriptionStatus && ` · ${subscription.team.subscriptionStatus}`}
                </p>
              </div>
              {team.stripeCustomerId && (
                <Button variant="secondary" onClick={() => void handlePortal()} isLoading={isOpeningPortal}>
                  <IconExternalLink size={16} />
                  Manage billing
                </Button>
              )}
            </div>

            <div className="team-panel__subscription-interval">
              <Select
                label="Billing interval"
                value={billingInterval}
                onChange={(event) => setBillingInterval(event.target.value as BillingInterval)}
                options={INTERVAL_OPTIONS}
              />
            </div>

            {subscriptionError && <p className="team-panel__error">{subscriptionError}</p>}
            {!subscription && !subscriptionError && (
              <p className="team-panel__loading">Loading plans…</p>
            )}

            <div className="team-panel__plans">
              {teamPlans.map((plan) => {
                const isCurrent = team.tier === plan.tier && (subscription?.team.billingInterval ?? 'month') === plan.interval;
                const features = getPlanFeatures(plan.tier);
                return (
                  <div
                    key={plan.tier}
                    className={`team-panel__plan ${isCurrent ? 'team-panel__plan--current' : ''}`}
                  >
                    <div className="team-panel__plan-head">
                      <span className="team-panel__plan-name">{PLAN_NAMES[plan.tier]}</span>
                      <span className="team-panel__plan-price">
                        {formatPlanPrice(plan)}
                        {plan.amount != null && <span>/{plan.interval === 'year' ? 'yr' : 'mo'}/seat</span>}
                      </span>
                    </div>
                    <ul className="team-panel__plan-features">
                      <li>{features.maxUsers} members</li>
                      <li>{features.maxDevices.toLocaleString()} devices</li>
                      <li>{features.sharedMonthlyCreditsPerUser.toLocaleString()} credits / member</li>
                    </ul>
                    <Button
                      variant={isCurrent ? 'secondary' : 'primary'}
                      disabled={isCurrent || checkoutTier !== null || !plan.priceId}
                      isLoading={checkoutTier === plan.tier}
                      onClick={() => void handleCheckout(plan.tier)}
                    >
                      {isCurrent ? 'Current plan' : 'Choose plan'}
                    </Button>
                  </div>
                );
              })}
            </div>
            <div className="team-panel__free-plan">
              <button type="button" className="team-panel__free-toggle" onClick={() => setShowFreePlan((value) => !value)}>
                <span>Free plan</span><span>{showFreePlan ? 'Hide' : 'Show'}</span>
              </button>
              {showFreePlan && (
                <div className="team-panel__free-content">
                  <span>1 member · 2 devices · 7 days data retention</span>
                  <Button variant={team.tier === 'free' ? 'secondary' : 'primary'} disabled={team.tier === 'free'} onClick={() => void handleFreePlan()}>
                    {team.tier === 'free' ? 'Current plan' : 'Choose free plan'}
                  </Button>
                </div>
              )}
            </div>
            {subscription && subscription.trialDays > 0 && (
              <p className="team-panel__subscription-note">
                New subscriptions include a {subscription.trialDays}-day free trial.
              </p>
            )}
            <div className="team-panel__danger-actions">
              <Button variant="danger" onClick={() => setConfirmation({ title: 'Delete team?', message: `Delete ${team.name ?? 'this team'}? This cannot be undone.`, action: () => void handleDeleteTeam() })}>
                Delete team
              </Button>
            </div>
          </section>
        </>
      )}

      {activeTab !== 'settings' && !isManager && (
        <section className="team-panel__leave">
          <Button variant="danger" onClick={() => setConfirmation({ title: 'Leave team?', message: `Leave ${team.name ?? 'this team'}?`, action: () => void handleLeaveTeam() })}>Leave team</Button>
        </section>
      )}

      <Modal
        isOpen={isInviteOpen}
        onClose={() => setIsInviteOpen(false)}
        onConfirm={handleInvite}
        title="Invite a team member"
        confirmText="Send invite"
        cancelText="Close"
        confirmDisabled={!identifier.trim()}
      >
        <div className="team-panel__invite-form">
          <Input
            label="Username or email"
            placeholder="username or name@example.com"
            helperText="Existing account is added; new emails receive an invite"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            fullWidth
          />
          <Select
            label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value as TeamRole)}
            options={ROLE_OPTIONS}
            fullWidth
          />
        </div>
      </Modal>

      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onConfirm={() => void handleCreateTeam()}
        title="Create a team"
        confirmText="Create team"
        cancelText="Cancel"
        confirmDisabled={isCreating}
      >
        <div className="team-panel__invite-form">
          <Input
            label="Team name"
            placeholder="My team"
            helperText={`New teams start on the free plan. You can join up to ${TEAM_LIMIT} teams.`}
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            fullWidth
          />
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(editingMember)}
        onClose={() => setEditingMember(null)}
        title={editingMember ? `Edit ${editingMember.username}` : 'Edit member'}
      >
        <div className="team-panel__invite-form">
          <Select
            label="Role"
            value={editRole}
            onChange={(e) => setEditRole(e.target.value as TeamRole)}
            options={ROLE_OPTIONS}
            fullWidth
          />
          <div className="team-panel__edit-actions">
            <Button variant="danger" onClick={handleEditRemove}>
              Remove from team
            </Button>
            <Button onClick={handleEditSave}>Save</Button>
          </div>
        </div>
      </Modal>
      <Modal
        isOpen={confirmation !== null}
        onClose={() => setConfirmation(null)}
        onConfirm={() => {
          const action = confirmation?.action;
          setConfirmation(null);
          action?.();
        }}
        title={confirmation?.title}
        confirmText="Continue"
        cancelText="Cancel"
        isDangerous
      >
        <p>{confirmation?.message}</p>
      </Modal>
    </div>
  );
}
