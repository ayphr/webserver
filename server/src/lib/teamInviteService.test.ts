import { describe, expect, test } from 'bun:test';
import type { Team, TeamInvite, User } from '@common';
import {
  InviteAcceptanceError,
  acceptTeamInvite,
  buildInviteClaimFilter,
  claimTeamInvite,
  type InviteCollection,
  type InviteServiceDeps,
  type TeamSeatReservationCollection,
} from './teamInviteService';

const NOW = Date.now();

function makeInvite(): TeamInvite {
  return {
    id: 'invite-1',
    teamId: 'team-1',
    email: 'new@example.com',
    role: 'member',
    token: 'token-1',
    invitedByUuid: 'manager-1',
    invitedByUsername: 'manager',
    createdAt: new Date(NOW),
    expiresAt: new Date(NOW + 60_000),
  };
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    uuid: 'user-1',
    username: 'new-user',
    email: 'new@example.com',
    role: 'user',
    auth: {},
    createdAt: new Date(NOW),
    lastActive: new Date(NOW),
    ...overrides,
  } as User;
}

const team = { id: 'team-1', managerUuid: 'manager-1', tier: 'pro' } as unknown as Team;
const manager = makeUser({ uuid: 'manager-1', username: 'manager' });

function fakeInvites(initial: TeamInvite = makeInvite()) {
  const state = new Map<string, TeamInvite>([[initial.id, initial]]);
  const collection = {
    findOneAndUpdate: async (
      filter: Parameters<InviteCollection['findOneAndUpdate']>[0],
      update: Parameters<InviteCollection['findOneAndUpdate']>[1],
    ) => {
      const id = filter.id as string;
      const expiry = filter.expiresAt as { $gt: Date } | undefined;
      const current = state.get(id);
      if (!current || current.acceptedAt || filter.email !== current.email || !expiry) return null;
      if (current.expiresAt.getTime() <= expiry.$gt.getTime()) return null;
      const next = { ...current, ...(update.$set as Partial<TeamInvite>) } as TeamInvite;
      state.set(id, next);
      return next;
    },
    updateOne: async (
      filter: Parameters<InviteCollection['updateOne']>[0],
      update: Parameters<InviteCollection['updateOne']>[1],
    ) => {
      const id = filter.id as string;
      const current = state.get(id);
      if (!current || current.acceptedByUuid !== filter.acceptedByUuid) return { modifiedCount: 0 };
      const next: Record<string, unknown> = { ...current };
      const unset = (update.$unset as Record<string, unknown> | undefined) ?? {};
      for (const key of Object.keys(unset)) delete next[key];
      state.set(id, next as TeamInvite);
      return { modifiedCount: 1 };
    },
  };
  return { collection, state };
}

function fakeTeams() {
  let pending = 0;
  const collection = {
    findOneAndUpdate: async (
      filter: Parameters<TeamSeatReservationCollection['findOneAndUpdate']>[0],
      update: Parameters<TeamSeatReservationCollection['findOneAndUpdate']>[1],
    ) => {
      const expr = filter.$expr as { $lt: [unknown, number] } | undefined;
      const available = expr?.$lt[1];
      if (available === undefined) throw new Error('seat-limit cutoff is missing from the filter');
      if (pending >= available) return null;
      const increments = update.$inc as Record<string, number> | undefined;
      pending += increments?.pendingSeatClaims ?? 0;
      return { id: 'team-1', pendingSeatClaims: pending };
    },
    updateOne: async (
      _filter: Parameters<TeamSeatReservationCollection['updateOne']>[0],
      update: Parameters<TeamSeatReservationCollection['updateOne']>[1],
    ) => {
      const increments = update.$inc as Record<string, number> | undefined;
      pending += increments?.pendingSeatClaims ?? 0;
      return { modifiedCount: 1 };
    },
  };
  return { collection, get pending() { return pending; } };
}

function makeDeps(options: {
  inviteState?: ReturnType<typeof fakeInvites>;
  teamsState?: ReturnType<typeof fakeTeams>;
  limit?: number;
  members?: User[];
  onAdd?: () => void;
} = {}) {
  const inviteState = options.inviteState ?? fakeInvites();
  const teamsState = options.teamsState ?? fakeTeams();
  let addCalls = 0;
  const deps: InviteServiceDeps = {
    invites: async () => inviteState.collection as never,
    teams: async () => teamsState.collection as never,
    getTeamById: async () => team,
    getUserFromUuid: async () => manager,
    getMembers: async () => options.members ?? [manager],
    getTeamSeatLimit: async () => options.limit ?? 5,
    addUserToTeam: async () => { addCalls += 1; options.onAdd?.(); },
    setUserTeamMembership: async () => {},
    syncSubscriptions: async () => {},
    logAudit: async () => ({}) as never,
    notify: async () => {},
  };
  return { deps, inviteState, teamsState, get addCalls() { return addCalls; } };
}

describe('team invite claim', () => {
  test('claim filter rechecks email, token, expiry and single use', () => {
    const invite = makeInvite();
    const filter = buildInviteClaimFilter(invite, ' NEW@EXAMPLE.COM ', new Date(NOW + 1000));
    expect(filter).toMatchObject({
      id: invite.id,
      token: invite.token,
      teamId: invite.teamId,
      email: invite.email,
      acceptedAt: { $exists: false },
    });
    expect(((filter.expiresAt as { $gt: Date }).$gt).getTime()).toBe(NOW + 1000);
  });

  test('rejects an email mismatch before touching the collection', async () => {
    const state = fakeInvites();
    const error = await claimTeamInvite(makeInvite(), makeUser({ email: 'other@example.com' }), {
      ...makeDeps({ inviteState: state }).deps,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InviteAcceptanceError);
    expect((error as InviteAcceptanceError).code).toBe('email_mismatch');
  });

  test('a second concurrent acceptance cannot claim the same invite', async () => {
    const state = fakeInvites();
    const { deps: baseDeps } = makeDeps({ inviteState: state });
    const first = await claimTeamInvite(makeInvite(), makeUser(), baseDeps);
    const second = await claimTeamInvite(makeInvite(), makeUser(), baseDeps);

    expect(first?.acceptedByUuid).toBe('user-1');
    expect(second).toBeNull();
  });

  test('concurrent acceptances create membership exactly once', async () => {
    const state = fakeInvites();
    const { deps } = makeDeps({ inviteState: state });
    const invite = makeInvite();
    const user = makeUser();

    const results = await Promise.allSettled([
      acceptTeamInvite({ invite, user, deps }),
      acceptTeamInvite({ invite, user, deps }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toBeDefined();
    if (rejected?.status === 'rejected') {
      expect((rejected.reason as InviteAcceptanceError).code).toBe('already_used');
    }
  });

  test('rechecks the seat limit after claiming and releases the claim when full', async () => {
    const state = fakeInvites();
    const { deps, inviteState, teamsState } = makeDeps({
      inviteState: state,
      limit: 1,
      members: [manager],
    });

    const error = await acceptTeamInvite({ invite: makeInvite(), user: makeUser(), deps })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InviteAcceptanceError);
    expect((error as InviteAcceptanceError).code).toBe('seat_limit');
    expect(inviteState.state.get('invite-1')?.acceptedAt).toBeUndefined();
    expect(teamsState.pending).toBe(0);
  });

  test('releases the temporary seat reservation after a successful accept', async () => {
    const state = fakeInvites();
    const harness = makeDeps({ inviteState: state, limit: 5 });
    const { deps, teamsState } = harness;

    await acceptTeamInvite({ invite: makeInvite(), user: makeUser(), deps });

    expect(harness.addCalls).toBe(1);
    expect(teamsState.pending).toBe(0);
    expect(state.state.get('invite-1')?.acceptedByUuid).toBe('user-1');
  });
});
