import { describe, expect, it } from 'bun:test';
import {
  ASSISTANT_MODEL_PRICING,
  USD_PER_CREDIT,
  estimateAssistantUsageCredits,
  estimateAssistantUsageUsd,
  estimateStreamingCredits,
  formatCreditCost,
  usdToCredits,
} from './assistantPricing';

describe('assistant credit pricing', () => {
  it('uses one credit per $0.005 of usage', () => {
    expect(USD_PER_CREDIT).toBe(0.005);
    expect(usdToCredits(0.005)).toBe(1);
    expect(usdToCredits(1)).toBe(200);
    expect(usdToCredits(-1)).toBe(0);
  });

  it('uses non-discounted list prices for every model', () => {
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
    // Carbon's $2/$10 introductory price must not be used.
    expect(ASSISTANT_MODEL_PRICING['gemini-4-carbon']).toEqual({
      inputUsdPerMillionTokens: 4,
      outputUsdPerMillionTokens: 20,
    });
  });

  it('converts input and output tokens to USD and credits', () => {
    expect(estimateAssistantUsageUsd('gemini-4-carbon', { inputTokens: 1_000_000, outputTokens: 0 })).toBe(4);
    expect(estimateAssistantUsageUsd('gemini-4-carbon', { inputTokens: 0, outputTokens: 1_000_000 })).toBe(20);
    expect(estimateAssistantUsageCredits('gemini-4-carbon', { inputTokens: 1_000_000, outputTokens: 0 })).toBe(800);
    expect(estimateAssistantUsageCredits('gemini-4-carbon', { inputTokens: 0, outputTokens: 1_000_000 })).toBe(4000);
    expect(estimateAssistantUsageCredits('gemini-3.5-flash-lite', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(560);
  });

  it('estimates live cost from the prepared context and streamed text', () => {
    // 400 characters is 100 estimated output tokens.
    expect(estimateStreamingCredits('gemini-3.5-flash-lite', 1_000_000, 'a'.repeat(400))).toBeCloseTo(60.05, 6);
    expect(estimateStreamingCredits('gemini-4-hydrogen', 0, '')).toBe(0);
  });

  it('formats running costs for the metadata footer', () => {
    expect(formatCreditCost(0)).toBe('0 credits');
    expect(formatCreditCost(0.126)).toBe('0.13 cr');
    expect(formatCreditCost(12.34)).toBe('12.3 cr');
  });
});
