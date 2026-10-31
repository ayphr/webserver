import { json, readJsonBody } from '../../lib/http';
import { requireAuth } from '../auth';
import { getGameBests, updateGameBest } from '../../lib/db';
import type { User } from '@common';

const VALID_GAMES = new Set(['memory', 'minesweeper']);

const handleGetBests = requireAuth(async (_request, user: User) => {
  const bests = await getGameBests(user.uuid);
  return json({ bests: bests ?? {} });
});

const handleUpdateBest = requireAuth(async (request, user: User) => {
  const body = await readJsonBody(request);
  const game = typeof body?.game === 'string' ? body.game : '';
  const value = typeof body?.value === 'number' ? body.value : Number(body?.value);

  if (!VALID_GAMES.has(game)) {
    return json({ error: 'invalid game' }, 400);
  }
  if (!Number.isFinite(value) || value < 0) {
    return json({ error: 'invalid value' }, 400);
  }

  const result = await updateGameBest(user.uuid, game as 'memory' | 'minesweeper', value);
  return json({ updated: result.updated, bests: result.bests ?? {} });
});

export { handleGetBests, handleUpdateBest };