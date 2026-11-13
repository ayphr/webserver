export type AssistantVariants = 'nano' | 'lite' | 'standard' | 'plus' | 'turbo';

export type AssistantThinkingLevel = 'low' | 'medium' | 'high' | 'xhigh';

export type AssistantData = {
  model: string;
  thinkingLevel?: AssistantThinkingLevel;
  usageRateMultiplierFromBaseline: number;
};

export const ASSISTANT_DATA: Record<AssistantVariants, AssistantData> = {
  nano: {
    model: 'gemini-3.5-flash-lite',
    usageRateMultiplierFromBaseline: 1,
  },
  lite: {
    model: 'gemini-4-hydrogen',
    thinkingLevel: 'low',
    usageRateMultiplierFromBaseline: 5,
  },
  standard: {
    model: 'gemini-4-hydrogen',
    thinkingLevel: 'medium',
    usageRateMultiplierFromBaseline: 6,
  },
  plus: {
    model: 'gemini-4-hydrogen',
    thinkingLevel: 'xhigh',
    usageRateMultiplierFromBaseline: 15,
  },
  turbo: {
    model: 'gemini-4-carbon',
    thinkingLevel: 'high',
    usageRateMultiplierFromBaseline: 40,
  },
};
