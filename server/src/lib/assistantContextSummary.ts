import { estimateTokens, type AssistantContextMessage } from '@common';

const SUMMARY_PREFIX = 'Summary of earlier conversation:\n';

/**
 * Deterministically condenses older chat messages before they leave the
 * context window. This is a local storage optimization, not a model response.
 */
export function summarizeAssistantContext(
  messages: AssistantContextMessage[],
  maxTokens: number,
): string {
  if (messages.length === 0) return '';

  const lines = messages
    .map((message) => {
      const content = message.content.replace(/\s+/g, ' ').trim();
      return content ? `- ${message.role}: ${content}` : '';
    })
    .filter(Boolean);
  if (lines.length === 0) return '';

  const prefixTokens = estimateTokens(SUMMARY_PREFIX);
  const bodyBudgetTokens = Math.max(1, maxTokens - prefixTokens);
  const maxChars = Math.max(1, bodyBudgetTokens * 4);
  let body = lines.join('\n');
  if (body.length > maxChars) body = `${body.slice(0, maxChars - 1)}…`;

  return `${SUMMARY_PREFIX}${body}`;
}
