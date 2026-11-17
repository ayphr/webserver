import type { User } from '@common';
import {
  acceptTeamInvite,
  ensureTeamForManager,
  getTeamInviteByToken,
} from './db/teams';
import { createUser } from './db';
import { createLogger } from './logger';

const log = createLogger('auth-registration');

export async function provisionRegisteredUser(user: User, inviteToken?: string): Promise<void> {
  await createUser(user);

  let inviteAccepted = false;
  if (inviteToken) {
    try {
      const invite = await getTeamInviteByToken(inviteToken);
      if (
        invite &&
        !invite.acceptedAt &&
        invite.expiresAt.getTime() > Date.now() &&
        invite.email === user.email?.toLowerCase()
      ) {
        await acceptTeamInvite({ invite, user });
        inviteAccepted = true;
      }
    } catch (error) {
      log.warn({ error, userUuid: user.uuid }, 'failed to accept team invite during registration');
    }
  }

  if (!inviteAccepted) {
    await ensureTeamForManager(user.uuid, 'free');
  }
}
