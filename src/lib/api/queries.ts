import type { QueryAssistRequest, QueryAssistResponse } from '@common';
import type { RequestClient } from './client';
import { API_PATHS, apiPath } from './generated/routes';

export function createQueriesApi(client: RequestClient) {
  return {
    /** Asks Iris to author a validated TQL query from a plain-language request. */
    async assist(input: QueryAssistRequest) {
      return client.requestJson<QueryAssistResponse>(apiPath(API_PATHS.postQueriesAssist), {
        method: 'POST',
        body: input,
      });
    },
  };
}
