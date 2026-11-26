import { useCallback, useEffect, useId, useState } from 'react';
import { api } from '../../lib/api';
import { Button, createTabKeyDownHandler, Select, Modal, PunishModal, Checkbox } from '../common';
import { IconArrowLeft, IconEye, IconTrash, IconUser } from '@tabler/icons-react';
import type { PublicUser, Team, CreditBalance } from '@common';
import { PLAN_NAMES, SUBSCRIPTION_TIERS } from '@common';
import type { StaffUserTab } from '../../lib/dashboardRoutes';
import '../common/Tabs.css';

type TeamEntry = { team: Team; role: string };

type Props = {
  user: PublicUser;
  onBack: () => void;
  tab?: StaffUserTab;
  onTabChange?: (tab: StaffUserTab) => void;
};

export function StaffUserDetailView({ user, onBack, tab: routeTab, onTabChange }: Props) {
  const [internalTab, setInternalTab] = useState<StaffUserTab>('overview');
  const tab = routeTab ?? internalTab;
  const selectTab = (next: StaffUserTab) => {
    if (routeTab === undefined) setInternalTab(next);
    onTabChange?.(next);
  };
  const tabIdPrefix = useId();
  const handleTabsKeyDown = createTabKeyDownHandler<StaffUserTab>(selectTab);

  const [teams, setTeams] = useState<TeamEntry[]>([]);
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const [devices, setDevices] = useState<{ count: number; dataPoints: number }>({ count: 0, dataPoints: 0 });
  const [locations, setLocations] = useState(0);
  const [loading, setLoading] = useState(true);
  const [modalTeam, setModalTeam] = useState<TeamEntry | null>(null);
  const [modalRole, setModalRole] = useState('member');
  const [modalTier, setModalTier] = useState<string>('');
  const [modalSeats, setModalSeats] = useState(1);
  const [modalGifted, setModalGifted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPunishOpen, setIsPunishOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [teamConfirmation, setTeamConfirmation] = useState<{ title: string; message: string; action: () => void } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const t = await api.staff.users.teams(user.uuid);
      setTeams(t);
      try {
        const c = await api.staff.users.credits(user.uuid);
        setCredits(c);
      } catch {
        setCredits(null);
      }
      try {
        const d = await api.staff.users.devices(user.uuid);
        setDevices({
          count: d.length,
          dataPoints: d.reduce((sum, dev) => sum + (dev.dataPointCount ?? 0), 0),
        });
      } catch {
        setDevices({ count: 0, dataPoints: 0 });
      }
      try {
        const l = await api.staff.users.locations(user.uuid);
        setLocations(l.length);
      } catch {
        setLocations(0);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [user.uuid]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const openModal = (entry: TeamEntry) => {
    setModalTeam(entry);
    setModalRole(entry.role);
    setModalTier(entry.team.tier);
    setModalSeats(entry.team.seats ?? 1);
    setModalGifted(Boolean(entry.team.gifted));
  };

  const saveModal = async () => {
    if (!modalTeam) return;
    setSaving(true);
    setActionError(null);
    try {
      await api.staff.teams.update(modalTeam.team.id, {
        tier: modalTier,
        seats: modalSeats,
        gifted: modalGifted,
      });
      await api.staff.teams.updateMemberRole(modalTeam.team.id, user.uuid, modalRole);
      setModalTeam(null);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const removeMember = async () => {
    if (!modalTeam) return;
    setSaving(true);
    try {
      await api.staff.teams.removeMember(modalTeam.team.id, user.uuid);
      setModalTeam(null);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to remove');
    } finally {
      setSaving(false);
    }
  };

  const deleteTeam = async () => {
    if (!modalTeam) return;
    setSaving(true);
    try {
      await api.staff.teams.delete(modalTeam.team.id);
      setModalTeam(null);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setSaving(false);
    }
  };

  const deleteUser = async () => {
    setSaving(true);
    setActionError(null);
    try {
      await api.staff.deleteUser(user.uuid);
      onBack();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setSaving(false);
      setIsDeleteOpen(false);
    }
  };

  const tabs: { id: StaffUserTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'teams', label: 'Teams' },
    { id: 'usage', label: 'Usage' },
    { id: 'actions', label: 'Actions' },
  ];

  return (
    <div className="staff-user-detail">
      <div className="staff-user-detail__header">
        <Button variant="secondary" onClick={onBack}>
          <IconArrowLeft size={16} /> Back
        </Button>
        <h2>{user.username}</h2>
      </div>

      <div className="ui-tabs" role="tablist" aria-label="User sections" onKeyDown={handleTabsKeyDown}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            data-tab-id={t.id}
            aria-selected={tab === t.id}
            aria-controls={`${tabIdPrefix}-panel-${t.id}`}
            id={`${tabIdPrefix}-tab-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={`ui-tab${tab === t.id ? ' ui-tab--active' : ''}`}
            onClick={() => selectTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <>
          {tab === 'overview' && (
            <div
              className="staff-user-detail__overview ui-tab-panel"
              role="tabpanel"
              id={`${tabIdPrefix}-panel-overview`}
              aria-labelledby={`${tabIdPrefix}-tab-overview`}
              tabIndex={0}
            >
              <div className="staff-user-detail__hero"><IconUser size={28} aria-hidden="true" /><div><h3>{user.username}</h3><span>{user.role}</span></div></div>
              <div className="staff-user-detail__facts">
                <div><span>Username</span><strong>{user.username}</strong></div>
                <div><span>User ID</span><strong className="staff-user-detail__mono">{user.uuid}</strong></div>
                <div><span>Teams</span><strong>{teams.length}</strong></div>
                <div><span>Active team</span><strong>{user.teamId ?? 'None selected'}</strong></div>
                <div><span>Badges</span><strong>{user.badges?.join(', ') || 'None'}</strong></div>
              </div>
            </div>
          )}

          {tab === 'teams' && (
            <div
              className="staff-user-detail__teams"
              role="tabpanel"
              id={`${tabIdPrefix}-panel-teams`}
              aria-labelledby={`${tabIdPrefix}-tab-teams`}
              tabIndex={0}
            >
              {teams.length === 0 ? (
                <p>No teams.</p>
              ) : (
                <ul>
                  {teams.map((entry) => (
                    <li key={entry.team.id} className="staff-user-detail__team-row">
                      <div className="staff-user-detail__team-info">
                        <strong>{entry.team.name ?? 'Unnamed team'}</strong>
                        <div className="staff-user-detail__team-meta">
                          <span><b>Plan</b>{PLAN_NAMES[entry.team.tier]}</span>
                          <span><b>Role</b>{entry.role}</span>
                          <span><b>Seats</b>{entry.team.seats ?? 'Member count'}</span>
                          {entry.team.gifted ? <span className="staff-user-detail__gifted">Gifted</span> : null}
                        </div>
                      </div>
                      <Button variant="secondary" onClick={() => openModal(entry)}>
                        <IconEye size={16} /> View
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === 'usage' && (
            <div
              className="staff-user-detail__usage ui-tab-panel"
              role="tabpanel"
              id={`${tabIdPrefix}-panel-usage`}
              aria-labelledby={`${tabIdPrefix}-tab-usage`}
              tabIndex={0}
            >
              <div className="staff-user-detail__usage-list">
                <div><span>Plan</span><strong>{credits?.plan ?? 'Free'}</strong></div>
                <div><span>Devices</span><strong>{devices.count}</strong></div>
                <div><span>Data points</span><strong>{devices.dataPoints.toLocaleString()}</strong></div>
                <div><span>Locations</span><strong>{locations}</strong></div>
                {credits && <div><span>Credits available</span><strong>{credits.available.toLocaleString()}</strong></div>}
              </div>
            </div>
          )}

          {tab === 'actions' && (
            <div
              className="staff-user-detail__actions ui-tab-panel"
              role="tabpanel"
              id={`${tabIdPrefix}-panel-actions`}
              aria-labelledby={`${tabIdPrefix}-tab-actions`}
              tabIndex={0}
            >
              <div className="staff-user-detail__action-row"><div><strong>Staff access</strong><span>Control whether this user can access staff tools.</span></div>
              <Select
                value={user.role}
                onChange={async (e) => {
                  try {
                    await api.staff.updateRole(user.uuid, { role: e.target.value as 'user' | 'staff' });
                    window.location.reload();
                  } catch (err) {
                    setActionError(err instanceof Error ? err.message : 'Failed');
                  }
                }}
                options={[
                  { value: 'user', label: 'User' },
                  { value: 'staff', label: 'Staff' },
                ]}
              /></div>
              <div className="staff-user-detail__action-row"><div><strong>Punishment</strong><span>Restrict this user's access with a timed punishment.</span></div><Button variant="danger" onClick={() => setIsPunishOpen(true)}>Punish user</Button></div>
              <div className="staff-user-detail__action-row staff-user-detail__action-row--danger"><div><strong>Delete user</strong><span>Permanently remove this user and their account data.</span></div><Button variant="danger" onClick={() => setIsDeleteOpen(true)}>Delete user</Button></div>
              {actionError && <p className="error" role="alert">{actionError}</p>}
            </div>
          )}
        </>
      )}

      <Modal isOpen={!!modalTeam} onClose={() => setModalTeam(null)} title="Team management">
        {modalTeam && (
          <div className="staff-team-modal">
            <p><strong>{modalTeam.team.name}</strong></p>
            <label>Role in team</label>
            <Select
              value={modalRole}
              onChange={(e) => setModalRole(e.target.value)}
              options={[
                { value: 'member', label: 'Member' },
                { value: 'helper', label: 'Helper' },
                { value: 'manager', label: 'Manager' },
              ]}
            />
            <label>Plan tier</label>
            <Select
              value={modalTier}
              onChange={(e) => setModalTier(e.target.value)}
              options={SUBSCRIPTION_TIERS.map((t) => ({ value: t, label: PLAN_NAMES[t] }))}
            />
            <label>Seats</label>
            <input
              type="number"
              min={1}
              value={modalSeats}
              onChange={(e) => setModalSeats(Number(e.target.value))}
            />
            <Checkbox
              label="Gifted mode (not billed)"
              checked={modalGifted}
              onChange={(e) => setModalGifted(e.target.checked)}
            />
            {actionError && <p className="error" role="alert">{actionError}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Button onClick={saveModal} disabled={saving}>Save</Button>
              <Button variant="secondary" onClick={() => setTeamConfirmation({ title: 'Remove from team?', message: 'This user will lose access to this team.', action: () => void removeMember() })} disabled={saving}>Remove from team</Button>
              <Button variant="danger" onClick={() => setTeamConfirmation({ title: 'Delete team?', message: 'This permanently deletes the entire team.', action: () => void deleteTeam() })} disabled={saving}>
                <IconTrash size={16} /> Delete team
              </Button>
            </div>
          </div>
        )}
      </Modal>
      <PunishModal
        isOpen={isPunishOpen}
        userUuid={user.uuid}
        username={user.username}
        onClose={() => setIsPunishOpen(false)}
        onPunish={() => setIsPunishOpen(false)}
      />
      <Modal
        isOpen={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        onConfirm={() => void deleteUser()}
        title="Delete user?"
        confirmText="Delete user"
        cancelText="Cancel"
        isDangerous
      >
        <p>This permanently deletes <strong>{user.username}</strong> and cannot be undone.</p>
      </Modal>
      <Modal
        isOpen={teamConfirmation !== null}
        onClose={() => setTeamConfirmation(null)}
        onConfirm={() => {
          const action = teamConfirmation?.action;
          setTeamConfirmation(null);
          action?.();
        }}
        title={teamConfirmation?.title}
        confirmText="Continue"
        cancelText="Cancel"
        isDangerous
      >
        <p>{teamConfirmation?.message}</p>
      </Modal>
    </div>
  );
}
