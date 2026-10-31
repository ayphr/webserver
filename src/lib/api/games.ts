import type { GameBests } from '@common';
import type { RequestClient } from './client';

export function createGamesApi(client: RequestClient) {
  return {
    async getBests() {
      return client.requestJson<{ bests: GameBests }>('/api/games/bests');
    },
    async updateBest(game: 'memory' | 'minesweeper', value: number) {
      return client.requestJson<{ updated: boolean; bests: GameBests }>('/api/games/bests', {
        method: 'POST',
        body: { game, value },
      });
    },
  };
}