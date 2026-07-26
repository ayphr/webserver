import { requireAuth } from '../auth';
import { getPunishmentById, getPunishmentsForUserUuid } from '../../workers/dbWriter';
import type { User } from '../../../../common';
import { handleApiNotFoundRoute } from './util';

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function publicUser(user: User) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { auth, ...rest } = user;
  return rest;
}

const handleMe = requireAuth(async (_request, user) => {
  const punishments = await getPunishmentsForUserUuid(user.uuid);
  const now = Date.now();
  const activeSuspension = punishments.find((punishment) => {
    return (
      punishment.type === 'suspension' &&
      !punishment.liftedAt &&
      new Date(punishment.startsAt).getTime() <= now &&
      punishment.endsAt ? new Date(punishment.endsAt).getTime() > now : null
    );
  }) ?? null;

  return json({
    user: publicUser(user),
    activeSuspension,
    punishments,
  });
}, { allowSuspended: true });

const handlePunishment = requireAuth(async (request, user) => {
  const punishmentId = new URL(request.url).pathname.split('/').pop();
  if (!punishmentId) {
    return handleApiNotFoundRoute(request);
  }

  const punishment = await getPunishmentById(punishmentId);
  if (!punishment) {
    return json({ error: 'punishment not found' }, 404);
  }

  if (punishment.userUuid !== user.uuid && user.role === 'user') {
    return json({ error: 'Forbidden' }, 403);
  }

  return json({ punishment });
}, { allowSuspended: true });

export function handlePunishmentsRoute(request: Request) {
  const url = new URL(request.url);

  if (request.method === 'GET' && url.pathname === '/api/punishments/me') {
    return handleMe(request);
  }

  if (request.method === 'GET' && url.pathname.startsWith('/api/punishments/')) {
    return handlePunishment(request);
  }

  return handleApiNotFoundRoute(request);
}
