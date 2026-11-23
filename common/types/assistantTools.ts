export const ASSISTANT_TOOL_NAMES = [
  'devices.list',
  'devices.data',
  'locations.list',
  'team.settings',
  'team.members',
  'user.question',
] as const;

export type AssistantToolName = (typeof ASSISTANT_TOOL_NAMES)[number];

export type AssistantQuestionStep = {
  id: string;
  prompt: string;
  suggestedAnswers: string[];
  recommendedAnswer?: string;
};

export type AssistantToolInput = Record<string, unknown>;

export type AssistantUserQuestion = {
  prompt: string;
  steps: AssistantQuestionStep[];
  customAnswerAllowed: boolean;
};

export type AssistantToolResult = {
  toolId: string;
  name: string;
  status: 'ok' | 'error';
  /** Short text shown inline in the chat. */
  summary: string;
  /** Structured payload for richer rendering. */
  data?: unknown;
  error?: string;
  /** Present for user.question tool calls. */
  question?: AssistantUserQuestion;
  answers?: Record<string, string>;
};

export type AssistantToolDefinition = {
  name: AssistantToolName;
  label: string;
  description: string;
  /** Shown in the permission prompt and the tool card. */
  permissionLabel: string;
  /** user.question waits for a reply before the assistant continues. */
  interactive?: boolean;
};

export const ASSISTANT_TOOL_DEFINITIONS: Record<AssistantToolName, AssistantToolDefinition> = {
  'devices.list': {
    name: 'devices.list',
    label: 'List devices',
    description: 'Read the devices linked to your account.',
    permissionLabel: 'read your device list',
  },
  'devices.data': {
    name: 'devices.data',
    label: 'Read device data',
    description: 'Read recent readings from one of your devices.',
    permissionLabel: 'read your device data',
  },
  'locations.list': {
    name: 'locations.list',
    label: 'List locations',
    description: 'Read the locations linked to your account.',
    permissionLabel: 'read your location list',
  },
  'team.settings': {
    name: 'team.settings',
    label: 'Read team settings',
    description: 'Read the settings of your team.',
    permissionLabel: 'read your team settings',
  },
  'team.members': {
    name: 'team.members',
    label: 'Read team members',
    description: 'Read the members of your team.',
    permissionLabel: 'read your team members',
  },
  'user.question': {
    name: 'user.question',
    label: 'Ask you a question',
    description: 'Ask a multi-step question and wait for your answer.',
    permissionLabel: 'ask you a question',
    interactive: true,
  },
};

export function isAssistantToolName(value: unknown): value is AssistantToolName {
  return typeof value === 'string' && ASSISTANT_TOOL_NAMES.includes(value as AssistantToolName);
}
