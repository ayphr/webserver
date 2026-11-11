import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { Team, TeamMember, TeamAuditLog, TeamRole } from '@common';
import './TeamPanel.css';

export function TeamPanel() {
  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [logs, setLogs] = useState<TeamAuditLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<TeamRole>('member');

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.teams.me();
      setTeam(data.team);
      setMembers(data.members);
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
    void load();
  }, []);

  const handleAdd = async () => {
    if (!username.trim()) return;
    try {
      await api.teams.addMember({ username: username.trim(), role });
      setUsername('');
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

  if (isLoading) return <p>Loading team…</p>;
  if (error) return <p className="team-panel__error">{error}</p>;
  if (!team) return <p>No team found. Team plans are required.</p>;

  return (
    <div className="team-panel">
      <h3>{team.name ?? 'Team'} ({team.tier})</h3>
      <section>
        <h4>Members</h4>
        <ul>
          {members.map((m) => (
            <li key={m.uuid}>
              {m.username} — {m.role}
              <select value={m.role} onChange={(e) => handleRoleChange(m.uuid, e.target.value as TeamRole)}>
                <option value="member">member</option>
                <option value="helper">helper</option>
                <option value="manager">manager</option>
              </select>
              <button onClick={() => handleRemove(m.uuid)}>Remove</button>
            </li>
          ))}
        </ul>
        <div>
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" />
          <select value={role} onChange={(e) => setRole(e.target.value as TeamRole)}>
            <option value="member">member</option>
            <option value="helper">helper</option>
            <option value="manager">manager</option>
          </select>
          <button onClick={handleAdd}>Add</button>
        </div>
      </section>
      <section>
        <h4>Audit logs</h4>
        <ul>
          {logs.map((l) => (
            <li key={l.id}>{l.action} by {l.actorUsername} {l.targetUsername ? `→ ${l.targetUsername}` : ''}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
