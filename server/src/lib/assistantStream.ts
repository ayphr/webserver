/**
 * Splits provider output into the word-sized chunks streamed to the client.
 * The client appends tokens in arrival order, so chunk boundaries only affect
 * pacing, not the final message. Leading whitespace is kept as its own token:
 * dropping it was causing words to run together when a provider delta began
 * with spaces or newlines.
 */
export const splitAssistantResponseIntoTokens = (
  text: string,
  options: { preserveWhitespaceOnly?: boolean } = {},
): string[] => {
  // Keep each whitespace run as its own token. Absorbing it into the previous
  // word made a whitespace-only live flush disappear as a separate event.
  const tokens = text.match(/\s+|\S+/g) ?? [];
  // A whitespace-only *response* has no visible content to stream. Live chunks
  // are different: a chunk that is exactly a space or newline must still be
  // emitted or the next word joins the previous one on the client.
  if (!options.preserveWhitespaceOnly && tokens.length === 1 && /^\s+$/.test(tokens[0]!)) {
    return [];
  }
  return tokens;
};
