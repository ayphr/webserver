export const ASSISTANT_VARIANTS: AssistantVariant[] = ['nano', 'lite', 'standard', 'plus', 'turbo'];
export type AssistantVariant = 'nano' | 'lite' | 'standard' | 'plus' | 'turbo';
export type AssistantSendShortcut = 'enter' | 'shift-enter';

export const ASSISTANT_MODES: AssistantMode[] = ['chat', 'task'];
export type AssistantMode = 'chat' | 'task';

export const ASSISTANT_STREAM_PATH = '/ws/assistant';

export type AssistantStreamClientMessage =
  | { type: 'stream'; requestId: string }
  | { type: 'cancel'; requestId: string };

export type AssistantStreamServerMessage =
  | { type: 'token'; requestId: string; token: string }
  | { type: 'done'; requestId: string }
  | { type: 'error'; requestId: string; error: string };

export type AssistantMessageFeedback = 'like' | 'dislike' | null;

export type AssistantMessage = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  interrupted?: boolean;
  feedback?: AssistantMessageFeedback;
  variant?: AssistantVariant;
  durationMs?: number;
};

export type AssistantFolder = {
  id: string;
  name: string;
  createdAt: number;
};

export type AssistantChat = {
  id: string;
  title: string;
  folderId: string | null;
  mode: AssistantMode;
  messages: AssistantMessage[];
  createdAt: number;
  updatedAt: number;
};

export type AssistantPreferences = {
  defaultVariant: AssistantVariant;
  sendShortcut: AssistantSendShortcut;
};

export type AssistantState = {
  chats: AssistantChat[];
  folders: AssistantFolder[];
  activeChatId: string | null;
  activeFolderId: string | null;
  activeMode: AssistantMode;
  preferences: AssistantPreferences;
};

export const DEFAULT_ASSISTANT_PREFERENCES: AssistantPreferences = {
  defaultVariant: 'standard',
  sendShortcut: 'enter',
};

export const createDefaultAssistantState = (): AssistantState => ({
  chats: [],
  folders: [],
  activeChatId: null,
  activeFolderId: null,
  activeMode: 'chat',
  preferences: { ...DEFAULT_ASSISTANT_PREFERENCES },
});

export type AssistantThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

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
    modelLabel: 'Gemini 3.5 Flash Lite (minimal)',
    variantLabel: 'Nano',
    thinkingLevel: 'minimal',
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
    model: 'gemini-4-neon',
    modelLabel: 'Gemini 4 Neon (high)',
    variantLabel: 'Plus',
    thinkingLevel: 'high',
    usageRateMultiplierFromBaseline: 25,
  },
  turbo: {
    model: 'gemini-4-carbon',
    modelLabel: 'Gemini 4 Carbon',
    variantLabel: 'Turbo',
    thinkingLevel: 'high',
    usageRateMultiplierFromBaseline: 40,
  },
};
