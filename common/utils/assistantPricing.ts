import type { AssistantModelId } from '../types/assistantModels';
import { estimateTokens } from './context';

/** One credit is worth USD 0.005 of model usage. */
export const USD_PER_CREDIT = 0.005;

export type AssistantModelPricing = {
  /** Published standard-tier price per 1M input tokens, in USD. */
  inputUsdPerMillionTokens: number;
  /** Published standard-tier price per 1M output tokens, in USD. */
  outputUsdPerMillionTokens: number;
};

/**
 * Gemini Developer API standard-tier *list* prices for the models exposed by
 * Iris, using non-discounted rates only. Time-limited introductory rates are
 * resolved separately by `resolveAssistantModelPricing` so the list table
 * stays a stable record.
 */
export const ASSISTANT_MODEL_PRICING: Record<AssistantModelId, AssistantModelPricing> = {
  'gemini-3.5-flash-lite': { inputUsdPerMillionTokens: 0.3, outputUsdPerMillionTokens: 2.5 },
  'gemini-4-hydrogen': { inputUsdPerMillionTokens: 1.5, outputUsdPerMillionTokens: 7.5 },
  'gemini-4-neon': { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 },
  'gemini-4-carbon': { inputUsdPerMillionTokens: 4, outputUsdPerMillionTokens: 20 },
};

/** Inclusive (UTC) end of the gemini-4-carbon introductory window. */
export const CARBON_INTRO_ENDS_AT = new Date('2026-12-01T00:00:00.000Z');
export const CARBON_INTRO_PRICING: AssistantModelPricing = {
  inputUsdPerMillionTokens: 2,
  outputUsdPerMillionTokens: 10,
};

/** Returns the rate that actually applies at `now`, including intro windows. */
export function resolveAssistantModelPricing(
  model: AssistantModelId,
  now: Date = new Date(),
): AssistantModelPricing {
  if (model === 'gemini-4-carbon' && now.getTime() < CARBON_INTRO_ENDS_AT.getTime()) {
    return CARBON_INTRO_PRICING;
  }
  return ASSISTANT_MODEL_PRICING[model];
}

export type AssistantUsageTokens = {
  inputTokens: number;
  outputTokens: number;
};

/** Converts token usage into the USD cost reported by the Gemini API. */
export function estimateAssistantUsageUsd(
  model: AssistantModelId,
  usage: AssistantUsageTokens,
  now: Date = new Date(),
): number {
  const pricing = resolveAssistantModelPricing(model, now);
  const input = Math.max(0, usage.inputTokens) / 1_000_000;
  const output = Math.max(0, usage.outputTokens) / 1_000_000;
  return input * pricing.inputUsdPerMillionTokens + output * pricing.outputUsdPerMillionTokens;
}

/** Converts a USD amount into credits, keeping fractional credits. */
export function usdToCredits(usd: number): number {
  return Math.max(0, usd) / USD_PER_CREDIT;
}

/** Convenience helper: token usage straight to credits. */
export function estimateAssistantUsageCredits(
  model: AssistantModelId,
  usage: AssistantUsageTokens,
  now: Date = new Date(),
): number {
  return usdToCredits(estimateAssistantUsageUsd(model, usage, now));
}

/**
 * Mid-stream estimate. Input tokens are known from the prepared context;
 * output tokens are estimated from the text emitted so far.
 */
export function estimateStreamingCredits(
  model: AssistantModelId,
  inputTokens: number,
  streamedText: string,
  now: Date = new Date(),
): number {
  return estimateAssistantUsageCredits(model, {
    inputTokens,
    outputTokens: estimateTokens(streamedText),
  }, now);
}

/** Human-readable cost used in the live stream metadata footer. */
export function formatCreditCost(credits: number): string {
  if (credits <= 0) return '0 credits';
  const rounded = credits < 1 ? Math.round(credits * 100) / 100 : Math.round(credits * 10) / 10;
  return `${rounded} cr`;
}
