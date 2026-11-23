import type { AssistantThinkingLevel } from './assistant';

export type AssistantModelInputType = 'text' | 'image' | 'video' | 'audio' | 'pdf';

export type AssistantModelCapability =
  | 'codeExecution'
  | 'computerUse'
  | 'contextCaching'
  | 'fileSearch'
  | 'functionCalling'
  | 'googleMapsGrounding'
  | 'googleSearchGrounding'
  | 'structuredOutputs'
  | 'urlContext';

/**
 * Static metadata for the Gemini models Iris can be backed by.
 *
 * Token limits are the published API limits for each model, not estimates:
 * - Gemini 4 models use a unified input/output context window, so output
 *   tokens have to be reserved from the same 1,048,576-token budget.
 * - Gemini 3.5 Flash-Lite has a separate 1,048,576-token input limit and a
 *   65,536-token output limit.
 */
export interface AssistantModelInfo {
  id: string;
  label: string;
  provider: 'google';
  contextWindowTokens: number;
  maxOutputTokens: number;
  unifiedContextWindow: boolean;
  inputTypes: readonly AssistantModelInputType[];
  outputTypes: readonly 'text'[];
  thinkingLevels: readonly AssistantThinkingLevel[];
  capabilities: readonly AssistantModelCapability[];
  stableVersion: string;
  latestUpdate: string;
  docsUrl: string;
  modelCardUrl: string;
}

export const ASSISTANT_MODELS = {
  'gemini-3.5-flash-lite': {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite',
    provider: 'google',
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 65_536,
    unifiedContextWindow: false,
    inputTypes: ['text', 'image', 'video', 'audio', 'pdf'],
    outputTypes: ['text'],
    thinkingLevels: ['minimal'],
    capabilities: [
      'codeExecution',
      'computerUse',
      'contextCaching',
      'fileSearch',
      'functionCalling',
      'googleMapsGrounding',
      'googleSearchGrounding',
      'structuredOutputs',
      'urlContext',
    ],
    stableVersion: 'gemini-3.5-flash-lite',
    latestUpdate: 'July 2026',
    docsUrl: 'https://aistudio.google.com/docs/models/gemini-3.5-flash-lite',
    modelCardUrl: 'https://deepmind.google/models/model-cards/gemini-3-5-flash-lite/',
  },
  'gemini-4-hydrogen': {
    id: 'gemini-4-hydrogen',
    label: 'Gemini 4 Hydrogen',
    provider: 'google',
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 65_536,
    unifiedContextWindow: true,
    inputTypes: ['text', 'image', 'video', 'audio', 'pdf'],
    outputTypes: ['text'],
    thinkingLevels: ['low', 'medium', 'high', 'xhigh'],
    capabilities: [
      'codeExecution',
      'computerUse',
      'contextCaching',
      'fileSearch',
      'functionCalling',
      'googleMapsGrounding',
      'googleSearchGrounding',
      'structuredOutputs',
      'urlContext',
    ],
    stableVersion: 'gemini-4-hydrogen',
    latestUpdate: 'November 2026',
    docsUrl: 'https://aistudio.google.com/docs/models/gemini-4-hydrogen',
    modelCardUrl: 'https://deepmind.google/models/model-cards/gemini-4-hydrogen/',
  },
  'gemini-4-neon': {
    id: 'gemini-4-neon',
    label: 'Gemini 4 Neon',
    provider: 'google',
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 65_536,
    unifiedContextWindow: true,
    inputTypes: ['text', 'image', 'video', 'audio', 'pdf'],
    outputTypes: ['text'],
    thinkingLevels: ['low', 'medium', 'high', 'xhigh'],
    capabilities: [
      'codeExecution',
      'computerUse',
      'contextCaching',
      'fileSearch',
      'functionCalling',
      'googleMapsGrounding',
      'googleSearchGrounding',
      'structuredOutputs',
      'urlContext',
    ],
    stableVersion: 'gemini-4-neon',
    latestUpdate: 'November 2026',
    docsUrl: 'https://aistudio.google.com/docs/models/gemini-4-neon',
    modelCardUrl: 'https://deepmind.google/models/model-cards/gemini-4-neon/',
  },
  'gemini-4-carbon': {
    id: 'gemini-4-carbon',
    label: 'Gemini 4 Carbon',
    provider: 'google',
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 65_536,
    unifiedContextWindow: true,
    inputTypes: ['text', 'image', 'video', 'audio', 'pdf'],
    outputTypes: ['text'],
    thinkingLevels: ['low', 'medium', 'high'],
    capabilities: [
      'codeExecution',
      'computerUse',
      'contextCaching',
      'fileSearch',
      'functionCalling',
      'googleMapsGrounding',
      'googleSearchGrounding',
      'structuredOutputs',
      'urlContext',
    ],
    stableVersion: 'gemini-4-carbon',
    latestUpdate: 'November 2026',
    docsUrl: 'https://aistudio.google.com/docs/models/gemini-4-carbon',
    modelCardUrl: 'https://deepmind.google/models/model-cards/gemini-4-carbon/',
  },
} as const satisfies Record<string, AssistantModelInfo>;

export type AssistantModelId = keyof typeof ASSISTANT_MODELS;

export const ASSISTANT_MODEL_IDS = Object.keys(ASSISTANT_MODELS) as AssistantModelId[];

export function isAssistantModelId(value: string): value is AssistantModelId {
  return Object.prototype.hasOwnProperty.call(ASSISTANT_MODELS, value);
}

export function getAssistantModel(id: string): AssistantModelInfo {
  if (isAssistantModelId(id)) return ASSISTANT_MODELS[id];
  const fallback = ASSISTANT_MODELS['gemini-4-hydrogen'];
  return { ...fallback, id, label: id };
}

/**
 * The number of input tokens Iris can actually use for conversation context.
 * Unified-window models need room reserved for the response; Flash-Lite's
 * input and output limits are separate.
 */
export function getAssistantInputBudget(id: string): number {
  const model = getAssistantModel(id);
  return model.unifiedContextWindow
    ? model.contextWindowTokens - model.maxOutputTokens
    : model.contextWindowTokens;
}
