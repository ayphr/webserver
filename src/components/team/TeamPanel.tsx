import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button, Input, Select } from '../common';
import type { Team, TeamMember, TeamAuditLog, TeamRole, TeamInvite } from '@common';
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
  const [logs, setLogs] = useState<TeamAuditLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamRole>('member');

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
      try {
        setLogs(await api.teams.auditLogs());
      } catch {
        setLogs([]);
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

  const handleAdd = async () => {
    if (!username.trim() && !email.trim()) return;
    setError(null);
    try {
      await api.teams.addMember({
        username: username.trim() || undefined,
        email: email.trim() || undefined,
        role,
      });
      setUsername('');
      setEmail('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member');
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
        <span className="team-panel__badge">{team.tier}</span>
      </header>

      <section className="team-panel__section">
        <h4 className="team-panel__section-title">Members</h4>
        <ul className="team-panel__list">
          {members.map((m) => (
            <li key={m.uuid} className="team-panel__list-item">
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

        <div className="team-panel__add">
          <Input
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <Input
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value as TeamRole)}
            options={ROLE_OPTIONS}
          />
          <Button onClick={handleAdd}>Add / Invite</Button>
        </div>
      </section>

      {invites.length > 0 && (
        <section className="team-panel__section">
          <h4 className="team-panel__section-title">Pending invites</h4>
          <ul className="team-panel__list">
            {invites.map((invite) => (
              <li key={invite.id} className="team-panel__list-item">
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

      <section className="team-panel__section">
        <h4 className="team-panel__section-title">Audit log</h4>
        <ul className="team-panel__list">
          {logs.map((log) => (
            <li key={log.id} className="team-panel__list-item">
              <span className="team-panel__audit-action">{log.action}</span>
              <span className="team-panel__audit-meta">
                by {log.actorUsername}
                {log.targetUsername ? ` → ${log.targetUsername}` : ''}
              </span>
            </li>
          ))}
          {logs.length === 0 && <li className="team-panel__empty">No audit entries yet.</li>}
        </ul>
      </section>
    </div>
  );
}
