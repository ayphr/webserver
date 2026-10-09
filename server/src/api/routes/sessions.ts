import { getBearerToken, requireAuth } from '../auth';
import { getSessionsForUserUuid } from '../../workers/dbWriter';
import type { SessionInfo } from '@common';

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

const handleListMine = requireAuth(async (request, user) => {
  const token = getBearerToken(request);
  const sessions = await getSessionsForUserUuid(user.uuid);

  const payload: SessionInfo[] = sessions.map((session) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { token: sessionToken, userUuid, ...rest } = session;
    return { ...rest, current: sessionToken === token };
  });

  return json({ sessions: payload });
}, { allowSuspended: true, allowPolicyPending: true });

export { handleListMine };
