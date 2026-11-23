/**
 * Splits provider output into the word-sized chunks streamed to the client.
 * The client appends tokens in arrival order, so chunk boundaries only affect
 * pacing, not the final message.
 */
export const splitAssistantResponseIntoTokens = (text: string): string[] =>
  text.match(/\S+\s*/g) ?? [];
