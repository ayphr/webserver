import { json, readJsonBody } from '../../lib/http';
import { requireAuth } from '../auth';
import { getPunishmentById, getPunishmentsForUserUuid, getActiveSuspensionForUserUuid } from '../../lib/db';
import { createAppeal, getAppealByPunishmentId } from '../../lib/db/appeals';
import { toSelfUser } from '../../lib/user';
import { randomUUID } from 'node:crypto';

const MAX_APPEAL_TEXT_LENGTH = 5000;

/** Shared by the route so the bound can be tested without a database. */
export function validateAppealText(text: string): string | null {
  if (!text) return 'Appeal text is required';
  if (text.length > MAX_APPEAL_TEXT_LENGTH) {
    return `Appeal text must be ${MAX_APPEAL_TEXT_LENGTH} characters or fewer`;
  }
  return null;
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
    user: await toSelfUser(user),
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

const handleAppealSubmit = requireAuth(async (request, user) => {
  const active = await getActiveSuspensionForUserUuid(user.uuid);
  if (!active) {
    return json({ error: 'No active suspension to appeal' }, 400);
  }

  const body = await readJsonBody(request);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const textError = validateAppealText(text);
  if (textError) {
    return json({ error: textError }, 400);
  }

  const existing = await getAppealByPunishmentId(active.id);
  if (existing) {
    return json({ error: 'An appeal has already been submitted for this suspension' }, 409);
  }

  const appeal = await createAppeal({
    id: randomUUID(),
    punishmentId: active.id,
    userUuid: user.uuid,
    userUsername: user.username,
    text,
    createdAt: new Date(),
    status: 'pending',
  });

  return json({ appeal }, 201);
}, { allowSuspended: true, allowPolicyPending: true, allowEmailMissing: true });

const handleAppealGet = requireAuth(async (_request, user, params) => {
  const punishmentId = params.id;
  if (!punishmentId) return json({ error: 'punishment id is required' }, 400);

  const punishment = await getPunishmentById(punishmentId);
  if (!punishment) return json({ error: 'punishment not found' }, 404);
  if (punishment.userUuid !== user.uuid && user.role !== 'staff') {
    return json({ error: 'Forbidden' }, 403);
  }

  const appeal = await getAppealByPunishmentId(punishmentId);
  return json({ appeal });
}, { allowSuspended: true, allowPolicyPending: true, allowEmailMissing: true });

export { handleMe, handlePunishment, handleAppealSubmit, handleAppealGet };
