import { getBearerToken, requireAuth } from '../auth';
import { deleteSession, getSessionById, getSessionsForUserUuid } from '../../workers/dbWriter';
import type { SessionInfo } from '@common';

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

const guardOptions = { allowSuspended: true, allowPolicyPending: true };

const handleListMine = requireAuth(async (request, user) => {
  const token = getBearerToken(request);
  const sessions = await getSessionsForUserUuid(user.uuid);

  const payload: SessionInfo[] = sessions.map((session) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { token: sessionToken, userUuid, ...rest } = session;
    return { ...rest, current: sessionToken === token };
  });

  return json({ sessions: payload });
}, guardOptions);

const handleRevoke = requireAuth(async (_request, user, params) => {
  const sessionId = params.id;

  if (!sessionId) {
    return json({ error: 'invalid session id' }, 400);
  }

  const session = await getSessionById(sessionId);

  if (!session) {
    return json({ error: 'session not found' }, 404);
  }

  if (session.userUuid !== user.uuid) {
    return json({ error: 'forbidden' }, 403);
  }

  await deleteSession(session.id);

  return new Response(null, { status: 204 });
}, guardOptions);

export { handleListMine, handleRevoke };
