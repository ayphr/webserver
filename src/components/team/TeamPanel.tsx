import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button, Checkbox, Input, Modal, Select } from '../common';
import { IconUserPlus } from '@tabler/icons-react';
import type { Team, TeamMember, TeamRole, TeamInvite } from '@common';
import './TeamPanel.css';

const ROLE_OPTIONS = [
  { value: 'member', label: 'Member' },
  { value: 'helper', label: 'Helper' },
  { value: 'manager', label: 'Manager' },
];

export function TeamPanel() {
  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [role, setRole] = useState<TeamRole>('member');
  const [migrateData, setMigrateData] = useState(false);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.teams.me();
      setTeam(data.team);
      setMembers(data.members);
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

  const handleRoleChange = async (uuid: string, newRole: TeamRole) => {
    try {
      await api.teams.updateRole(uuid, { role: newRole });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role');
    }
  };

  const handleRemove = async (uuid: string) => {
    try {
      await api.teams.removeMember(uuid);
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

  if (isLoading) return <p className="team-panel__loading">Loading team…</p>;
  if (error) return <p className="team-panel__error">{error}</p>;
  if (!team) return <p className="team-panel__empty">No team found. A team plan is required.</p>;

  return (
    <div className="team-panel">
      <header className="team-panel__header">
        <h3 className="team-panel__title">{team.name ?? 'Team'}</h3>
        <Button variant="secondary" onClick={() => setIsInviteOpen(true)}>
          <IconUserPlus size={16} />
          Invite member
        </Button>
      </header>

      <section className="team-panel__section team-panel__section--plain">
        <h4 className="team-panel__section-title">Members</h4>
        <ul className="team-panel__list team-panel__list--plain">
          {members.map((m) => (
            <li key={m.uuid} className="team-panel__member-row">
              <div className="team-panel__member-info">
                <span className="team-panel__member-name">{m.username}</span>
                <span className="team-panel__member-role">{m.role}</span>
              </div>
              <div className="team-panel__member-actions">
                <Select
                  value={m.role}
                  onChange={(e) => handleRoleChange(m.uuid, e.target.value as TeamRole)}
                  options={ROLE_OPTIONS}
                />
                <Button variant="danger" onClick={() => handleRemove(m.uuid)}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
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
                <Button variant="secondary" onClick={() => handleRevokeInvite(invite.id)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
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
    </div>
  );
}
