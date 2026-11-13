export const ASSISTANT_VARIANTS: AssistantVariant[] = ['nano', 'lite', 'standard', 'plus', 'turbo'];
export type AssistantVariant = 'nano' | 'lite' | 'standard' | 'plus' | 'turbo';

export type AssistantThinkingLevel = 'low' | 'medium' | 'high' | 'xhigh';

export type AssistantData = {
  model: string;
  modelLabel: string;
  variantLabel: string;
  thinkingLevel?: AssistantThinkingLevel;
  usageRateMultiplierFromBaseline: number;
};

export const ASSISTANT_DATA: Record<AssistantVariant, AssistantData> = {
  nano: {
    model: 'gemini-3.5-flash-lite',
    modelLabel: 'Gemini 3.5 Flash Lite',
    variantLabel: 'Nano',
    usageRateMultiplierFromBaseline: 1,
  },
  lite: {
    model: 'gemini-4-hydrogen',
    modelLabel: 'Gemini 4 Hydrogen (low)',
    variantLabel: 'Lite',
    thinkingLevel: 'low',
    usageRateMultiplierFromBaseline: 5,
  },
  standard: {
    model: 'gemini-4-hydrogen',
    modelLabel: 'Gemini 4 Hydrogen (medium)',
    variantLabel: 'Standard',
    thinkingLevel: 'medium',
    usageRateMultiplierFromBaseline: 6,
  },
  plus: {
    model: 'gemini-4-hydrogen',
    modelLabel: 'Gemini 4 Hydrogen (xhigh)',
    variantLabel: 'Plus',
    thinkingLevel: 'xhigh',
    usageRateMultiplierFromBaseline: 15,
  },
  turbo: {
    model: 'gemini-4-carbon',
    modelLabel: 'Gemini 4 Carbon',
    variantLabel: 'Turbo',
    thinkingLevel: 'high',
    usageRateMultiplierFromBaseline: 40,
  },
};
