import type { GameBests } from '@common';
import type { RequestClient } from './client';
import { API_PATHS, apiPath } from './generated/routes';

export function createGamesApi(client: RequestClient) {
  return {
    async getBests() {
      return client.requestJson<{ bests: GameBests }>(apiPath(API_PATHS.getGamesBests));
    },
    async updateBest(game: 'memory' | 'minesweeper', value: number) {
      return client.requestJson<{ updated: boolean; bests: GameBests }>(apiPath(API_PATHS.postGamesBests), {
        method: 'POST',
        body: { game, value },
      });
    },
  };
}