import { requireAuth } from '../auth';
import { getActiveSuspensionForUserUuid, getUserFromUuid } from '../../workers/dbWriter';
import type { User } from '@common';

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function publicUser(user: User) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { auth, ...rest } = user;
  return rest;
}

const handleMe = requireAuth(async (_request, user) => {
  const activeSuspension = await getActiveSuspensionForUserUuid(user.uuid);
  return json({
    user: publicUser(user),
    activeSuspension,
  });
}, { allowSuspended: true });

const handleUserByUuid = requireAuth(async (_request, user, params) => {
  const targetUuid = params.uuid;

  if (!targetUuid) {
    return json({ error: 'user uuid is required' }, 400);
  }

  const targetUser = await getUserFromUuid(targetUuid);
  if (!targetUser) {
    return json({ error: 'user not found' }, 404);
  }

  return json({ user: publicUser(targetUser), requestedBy: publicUser(user) });
}, { allowSuspended: true });

export { handleMe, handleUserByUuid };
