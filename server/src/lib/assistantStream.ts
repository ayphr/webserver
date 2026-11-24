/**
 * Splits provider output into the word-sized chunks streamed to the client.
 * The client appends tokens in arrival order, so chunk boundaries only affect
 * pacing, not the final message. Leading whitespace is kept as its own token:
 * dropping it was causing words to run together when a provider delta began
 * with spaces or newlines.
 */
export const splitAssistantResponseIntoTokens = (text: string): string[] => {
  const tokens = text.match(/\s+|\S+\s*/g) ?? [];
  // A whitespace-only response has no visible content to stream.
  return tokens.length === 1 && /^\s+$/.test(tokens[0]!) ? [] : tokens;
};
