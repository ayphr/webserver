import { requireAuth } from '../auth';
import { getPunishmentById, getPunishmentsForUserUuid } from '../../lib/db';
import { toPublicUser } from '../../lib/user';

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

const handleMe = requireAuth(async (_request, user) => {
  const punishments = await getPunishmentsForUserUuid(user.uuid);
  const now = Date.now();
  const activeSuspension = punishments.find((punishment) => {
    return (
      punishment.type === 'suspension' &&
      !punishment.liftedAt &&
      new Date(punishment.startsAt).getTime() <= now &&
      (punishment.endsAt === null || new Date(punishment.endsAt).getTime() > now)
    );
  }) ?? null;

  return json({
    user: toPublicUser(user),
    activeSuspension,
    punishments,
  });
}, { allowSuspended: true });

const handlePunishment = requireAuth(async (_request, user, params) => {
  const punishmentId = params.id;
  if (!punishmentId) {
    return json({ error: 'punishment not found' }, 404);
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

export { handleMe, handlePunishment };
