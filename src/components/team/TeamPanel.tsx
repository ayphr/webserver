import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button, Checkbox, Input, Modal, Select, ProgressBar } from '../common';
import { IconUserPlus, IconEdit, IconCoin, IconDeviceDesktop, IconMapPin, IconDatabase } from '@tabler/icons-react';
import type { Team, TeamMember, TeamRole, TeamInvite, CreditBalance } from '@common';
import { getPlanFeatures } from '@common/utils/plans';
import { TeamAuditPanel } from './TeamAuditPanel';
import './TeamPanel.css';

const ROLE_OPTIONS = [
  { value: 'member', label: 'Member' },
  { value: 'helper', label: 'Helper' },
  { value: 'manager', label: 'Manager' },
];

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
  const [migrateData, setMigrateData] = useState(false);
  const [activeTab, setActiveTab] = useState<TeamTab>('members');
  const [teamName, setTeamName] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const [usageCredits, setUsageCredits] = useState<CreditBalance | null>(null);
  const [usageDevices, setUsageDevices] = useState<{ count: number; dataPoints: number }>({ count: 0, dataPoints: 0 });
  const [usageLocations, setUsageLocations] = useState(0);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSuccess, setNameSuccess] = useState<string | null>(null);

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
        migrateData,
      });
      setIdentifier('');
      setRole('member');
      setMigrateData(false);
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

  if (isLoading) return <p className="team-panel__loading">Loading team…</p>;
  if (error) return <p className="team-panel__error">{error}</p>;
  if (!team) return <p className="team-panel__empty">No team found. A team plan is required.</p>;

  const isTeamManager = !!userUuid && team?.managerUuid === userUuid;

  const tabs: { id: TeamTab; label: string }[] = [
    { id: 'members', label: 'Members' },
    { id: 'usage', label: 'Usage' },
    ...(isManager ? [{ id: 'audit' as TeamTab, label: 'Audit' }, { id: 'settings' as TeamTab, label: 'Settings' }] : []),
  ];

  return (
    <div className="team-panel">
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
          <Checkbox
            label="Migrate their existing devices and locations into the team"
            checked={migrateData}
            onChange={(e) => setMigrateData(e.target.checked)}
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
    </div>
  );
}