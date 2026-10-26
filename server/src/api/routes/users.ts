import { requireAuth } from '../auth';
import { getActiveSuspensionForUserUuid, getUserFromUuid, updateUser } from '../../lib/db';
import { getPolicyStatus } from '../../lib/policies';
import { toPublicUser } from '../../lib/user';

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

const handleMe = requireAuth(async (_request, user) => {
  const activeSuspension = await getActiveSuspensionForUserUuid(user.uuid);
  const policyStatus = await getPolicyStatus(user);
  return json({
    user: toPublicUser(user),
    activeSuspension,
    policyStatus,
  });
}, { allowSuspended: true, allowPolicyPending: true });

const handleUserByUuid = requireAuth(async (_request, user, params) => {
  const targetUuid = params.uuid;

  if (!targetUuid) {
    return json({ error: 'user uuid is required' }, 400);
  }

  const targetUser = await getUserFromUuid(targetUuid);
  if (!targetUser) {
    return json({ error: 'user not found' }, 404);
  }

  return json({ user: toPublicUser(targetUser), requestedBy: toPublicUser(user) });
}, { allowSuspended: true });



const handleDeveloperToggle = requireAuth(async (request, user) => {
  const body = await request.json().catch(() => null) as { enabled?: boolean } | null;
  const enabled = body?.enabled === true;
  user.developerAccount = enabled;
  await updateUser(user);
  return json({ user: toPublicUser(user) });
}, { allowSuspended: true, allowPolicyPending: true });

export { handleMe, handleUserByUuid, handleDeveloperToggle };
