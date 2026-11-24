import { describe, expect, it } from 'bun:test';
import {
  ASSISTANT_MODEL_PRICING,
  CARBON_INTRO_ENDS_AT,
  CARBON_INTRO_PRICING,
  USD_PER_CREDIT,
  estimateAssistantUsageCredits,
  estimateAssistantUsageUsd,
  estimateStreamingCredits,
  formatCreditCost,
  resolveAssistantModelPricing,
  usdToCredits,
} from './assistantPricing';

/** Date after every introductory window, used for list-rate assertions. */
const listRateDate = new Date('2026-12-01T00:00:00.000Z');

describe('assistant credit pricing', () => {
  it('uses one credit per $0.005 of usage', () => {
    expect(USD_PER_CREDIT).toBe(0.005);
    expect(usdToCredits(0.005)).toBe(1);
    expect(usdToCredits(1)).toBe(200);
    expect(usdToCredits(-1)).toBe(0);
  });

  it('keeps non-discounted list prices in the rate table', () => {
    expect(ASSISTANT_MODEL_PRICING['gemini-3.5-flash-lite']).toEqual({
      inputUsdPerMillionTokens: 0.3,
      outputUsdPerMillionTokens: 2.5,
    });
    expect(ASSISTANT_MODEL_PRICING['gemini-4-hydrogen']).toEqual({
      inputUsdPerMillionTokens: 1.5,
      outputUsdPerMillionTokens: 7.5,
    });
    expect(ASSISTANT_MODEL_PRICING['gemini-4-neon']).toEqual({
      inputUsdPerMillionTokens: 3,
      outputUsdPerMillionTokens: 15,
    });
    expect(ASSISTANT_MODEL_PRICING['gemini-4-carbon']).toEqual({
      inputUsdPerMillionTokens: 4,
      outputUsdPerMillionTokens: 20,
    });
  });

  it('applies gemini-4-carbon introductory pricing through 2026-11-30 only', () => {
    expect(CARBON_INTRO_ENDS_AT.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(CARBON_INTRO_PRICING).toEqual({
      inputUsdPerMillionTokens: 2,
      outputUsdPerMillionTokens: 10,
    });
    const during = new Date('2026-11-24T10:00:00.000Z');
    expect(resolveAssistantModelPricing('gemini-4-carbon', during)).toEqual(CARBON_INTRO_PRICING);
    expect(resolveAssistantModelPricing('gemini-4-carbon', new Date('2026-11-30T23:59:59.000Z'))).toEqual(CARBON_INTRO_PRICING);
    expect(resolveAssistantModelPricing('gemini-4-carbon', listRateDate)).toEqual(
      ASSISTANT_MODEL_PRICING['gemini-4-carbon'],
    );
    expect(resolveAssistantModelPricing('gemini-4-neon', during)).toEqual(
      ASSISTANT_MODEL_PRICING['gemini-4-neon'],
    );
  });

  it('does not overcharge carbon during the introductory window', () => {
    const during = new Date('2026-11-24T10:00:00.000Z');
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
    expect(estimateAssistantUsageUsd('gemini-4-carbon', usage, during)).toBe(12);
    expect(estimateAssistantUsageCredits('gemini-4-carbon', usage, during)).toBe(2400);
    expect(estimateAssistantUsageCredits('gemini-4-carbon', usage, listRateDate)).toBe(4800);
    expect(estimateAssistantUsageCredits('gemini-4-carbon', { inputTokens: 0, outputTokens: 1_000_000 }, during)).toBe(2000);
  });

  it('converts input and output tokens to USD and credits at list rates', () => {
    expect(estimateAssistantUsageUsd('gemini-4-carbon', { inputTokens: 1_000_000, outputTokens: 0 }, listRateDate)).toBe(4);
    expect(estimateAssistantUsageUsd('gemini-4-carbon', { inputTokens: 0, outputTokens: 1_000_000 }, listRateDate)).toBe(20);
    expect(estimateAssistantUsageCredits('gemini-4-carbon', { inputTokens: 1_000_000, outputTokens: 0 }, listRateDate)).toBe(800);
    expect(estimateAssistantUsageCredits('gemini-4-carbon', { inputTokens: 0, outputTokens: 1_000_000 }, listRateDate)).toBe(4000);
    expect(estimateAssistantUsageCredits('gemini-3.5-flash-lite', { inputTokens: 1_000_000, outputTokens: 1_000_000 }, listRateDate)).toBe(560);
  });

  it('estimates live cost from the prepared context and streamed text', () => {
    // 400 characters is 100 estimated output tokens.
    expect(estimateStreamingCredits('gemini-3.5-flash-lite', 1_000_000, 'a'.repeat(400), listRateDate)).toBeCloseTo(60.05, 6);
    expect(estimateStreamingCredits('gemini-4-hydrogen', 0, '', listRateDate)).toBe(0);
  });

  it('formats running costs for the metadata footer', () => {
    expect(formatCreditCost(0)).toBe('0 credits');
    expect(formatCreditCost(0.126)).toBe('0.13 cr');
    expect(formatCreditCost(12.34)).toBe('12.3 cr');
  });
});
