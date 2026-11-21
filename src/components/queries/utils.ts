import {
  createDefaultQueryRange,
  DEFAULT_TQL_QUERY,
  type QueryDraft,
} from '@common';

export function createQueryDraft(serials: number[] = []): QueryDraft {
  return {
    type: 'standard',
    query: DEFAULT_TQL_QUERY,
    context: { serials: [...serials] },
    range: createDefaultQueryRange(),
  };
}
