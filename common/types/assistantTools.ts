export const ASSISTANT_TOOL_NAMES = [
  'devices.list',
  'devices.data',
  'devices.uptime',
  'devices.logs',
  'devices.tokens',
  'devices.forecast',
  'locations.list',
  'locations.detail',
  'alerts.list',
  'alerts.create',
  'alerts.update',
  'alerts.delete',
  'alerts.test',
  'alerts.mute',
  'integrations.list',
  'team.settings',
  'team.members',
  'team.audit',
  'team.invites',
  'credits.balance',
  'notifications.list',
  'notifications.read',
  'sessions.list',
  'user.profile',
  'assistant.chats',
  'help.search',
  'location.create',
  'device.rename',
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
  /** Needs approval under "Sometimes ask". */
  sensitive?: boolean;
  /** user.question waits for a reply before the assistant continues. */
  interactive?: boolean;
  /** JSON Schema describing the arguments the model may pass. */
  parameters?: Record<string, unknown>;
};

const DEVICE_ARG = {
  deviceId: {
    type: 'string',
    description: 'A device name or serial. Omit to use the first available device.',
  },
};

const ALERT_CONDITION_SCHEMA = {
  type: 'object',
  properties: {
    metric: { type: 'string', enum: ['temperature', 'humidity', 'airPressure'] },
    operator: { type: 'string', enum: ['lt', 'gt'] },
    value: { type: 'number' },
  },
  required: ['metric', 'operator', 'value'],
  additionalProperties: false,
};

export const ASSISTANT_TOOL_DEFINITIONS: Record<AssistantToolName, AssistantToolDefinition> = {
  'devices.list': {
    name: 'devices.list',
    label: 'List devices',
    description: 'Read the devices linked to your account.',
    permissionLabel: 'read your device list',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
      additionalProperties: false,
    },
  },
  'devices.data': {
    name: 'devices.data',
    label: 'Read device data',
    description: 'Read recent readings from one of your devices.',
    permissionLabel: 'read your device data',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        deviceId: DEVICE_ARG.deviceId,
        metric: { type: 'string', enum: ['temperature', 'humidity', 'airPressure', 'all'] },
        hours: { type: 'integer', minimum: 1, maximum: 720 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
  'devices.uptime': {
    name: 'devices.uptime',
    label: 'Check device availability',
    description:
      'Check how available a device has been recently, including the latest gap in its readings.',
    permissionLabel: 'check your device availability',
    sensitive: true,
    parameters: { type: 'object', properties: DEVICE_ARG, additionalProperties: false },
  },
  'devices.logs': {
    name: 'devices.logs',
    label: 'Read device logs',
    description: 'Read recent activity and error messages reported by one of your devices.',
    permissionLabel: 'read your device logs',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        ...DEVICE_ARG,
        level: { type: 'string', enum: ['all', 'info', 'warning', 'error'] },
        event: {
          type: 'string',
          enum: [
            'all',
            'upload_success',
            'upload_error',
            'auth_error',
            'malformed_data',
            'rate_limited',
            'token_revoked',
          ],
        },
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
  'devices.tokens': {
    name: 'devices.tokens',
    label: 'List device upload tokens',
    description: 'Read the status and activity of upload tokens for one of your devices.',
    permissionLabel: 'read your device upload tokens',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: { ...DEVICE_ARG, limit: { type: 'integer', minimum: 1, maximum: 100 } },
      additionalProperties: false,
    },
  },
  'devices.forecast': {
    name: 'devices.forecast',
    label: 'Forecast device readings',
    description: 'Estimate likely future temperature, humidity, and pressure for a device.',
    permissionLabel: 'forecast your device readings',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        ...DEVICE_ARG,
        hours: { type: 'integer', minimum: 1, maximum: 168 },
      },
      additionalProperties: false,
    },
  },
  'locations.list': {
    name: 'locations.list',
    label: 'List locations',
    description: 'Read the locations linked to your account.',
    permissionLabel: 'read your location list',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
      additionalProperties: false,
    },
  },
  'locations.detail': {
    name: 'locations.detail',
    label: 'Read location details',
    description: 'Read one location, including how many devices are assigned to it.',
    permissionLabel: 'read your location details',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: { locationId: { type: 'string' } },
      additionalProperties: false,
    },
  },
  'alerts.list': {
    name: 'alerts.list',
    label: 'List alerts',
    description: 'Read the alert rules configured for a device or across your devices.',
    permissionLabel: 'read your alert rules',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        ...DEVICE_ARG,
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
  'alerts.create': {
    name: 'alerts.create',
    label: 'Create an alert',
    description: 'Add an alert rule that watches one or more readings from a device.',
    permissionLabel: 'create an alert rule',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        ...DEVICE_ARG,
        name: { type: 'string' },
        logic: { type: 'string', enum: ['and', 'or'] },
        conditions: { type: 'array', items: ALERT_CONDITION_SCHEMA, minItems: 1, maxItems: 6 },
        integrationIds: { type: 'array', items: { type: 'string' } },
        repeatIntervalMinutes: { type: 'integer', minimum: 1, maximum: 10080 },
        enabled: { type: 'boolean' },
      },
      required: ['name', 'conditions'],
      additionalProperties: false,
    },
  },
  'alerts.update': {
    name: 'alerts.update',
    label: 'Edit an alert',
    description: 'Change an alert rule, including its name, threshold, schedule, or destinations.',
    permissionLabel: 'change an alert rule',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        logic: { type: 'string', enum: ['and', 'or'] },
        conditions: { type: 'array', items: ALERT_CONDITION_SCHEMA, minItems: 1, maxItems: 6 },
        integrationIds: { type: 'array', items: { type: 'string' } },
        repeatIntervalMinutes: { type: 'integer', minimum: 1, maximum: 10080 },
        enabled: { type: 'boolean' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  'alerts.delete': {
    name: 'alerts.delete',
    label: 'Delete an alert',
    description: 'Permanently remove an alert rule.',
    permissionLabel: 'delete an alert rule',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  'alerts.test': {
    name: 'alerts.test',
    label: 'Test an alert',
    description: 'Send a sample notification for an alert to check its destinations.',
    permissionLabel: 'test an alert rule',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  'integrations.list': {
    name: 'integrations.list',
    label: 'List integrations',
    description: 'Read the notification integrations connected to your workspace.',
    permissionLabel: 'read your integrations',
    sensitive: true,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  'team.settings': {
    name: 'team.settings',
    label: 'Read team settings',
    description: 'Read the settings of your team.',
    permissionLabel: 'read your team settings',
    sensitive: true,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  'team.members': {
    name: 'team.members',
    label: 'Read team members',
    description: 'Read the members of your team.',
    permissionLabel: 'read your team members',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
      additionalProperties: false,
    },
  },
  'team.audit': {
    name: 'team.audit',
    label: 'Read team activity',
    description: 'Read recent significant changes made in your workspace.',
    permissionLabel: 'read your team activity',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
      additionalProperties: false,
    },
  },
  'team.invites': {
    name: 'team.invites',
    label: 'Read pending invitations',
    description: 'Read pending invitations to your workspace.',
    permissionLabel: 'read your pending invitations',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
      additionalProperties: false,
    },
  },
  'credits.balance': {
    name: 'credits.balance',
    label: 'Check credit balance',
    description: 'Read the remaining credits available on your plan.',
    permissionLabel: 'read your credit balance',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  'notifications.list': {
    name: 'notifications.list',
    label: 'Read notifications',
    description: 'Read recent notifications, optionally only the unread ones.',
    permissionLabel: 'read your notifications',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        filter: { type: 'string', enum: ['all', 'unread'] },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
  'notifications.read': {
    name: 'notifications.read',
    label: 'Mark notifications read',
    description: 'Mark one notification or all notifications as read.',
    permissionLabel: 'mark your notifications as read',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' }, all: { type: 'boolean' } },
      additionalProperties: false,
    },
  },
  'sessions.list': {
    name: 'sessions.list',
    label: 'List active sessions',
    description: 'Read where and when you are currently signed in.',
    permissionLabel: 'read your active sessions',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
      additionalProperties: false,
    },
  },
  'user.profile': {
    name: 'user.profile',
    label: 'Read your profile',
    description: 'Read your account profile and plan details.',
    permissionLabel: 'read your profile',
    sensitive: true,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  'assistant.chats': {
    name: 'assistant.chats',
    label: 'List assistant chats',
    description: 'Read the titles and recent activity of your assistant conversations.',
    permissionLabel: 'read your assistant conversations',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
      additionalProperties: false,
    },
  },
  'help.search': {
    name: 'help.search',
    label: 'Look up app help',
    description: 'Look up guidance on using Ayphr features, without needing live account data.',
    permissionLabel: 'look up app guidance',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 10 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  'alerts.mute': {
    name: 'alerts.mute',
    label: 'Mute an alert',
    description: 'Pause or resume notifications for one of your alert rules.',
    permissionLabel: 'change your alert rules',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        minutes: { type: 'integer', minimum: 0, maximum: 10_080 },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  'location.create': {
    name: 'location.create',
    label: 'Create a location',
    description: 'Add a new location to your workspace.',
    permissionLabel: 'add a location',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  'device.rename': {
    name: 'device.rename',
    label: 'Rename a device',
    description: 'Change the display name of one of your devices.',
    permissionLabel: 'rename a device',
    sensitive: true,
    parameters: {
      type: 'object',
      properties: { ...DEVICE_ARG, name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  'user.question': {
    name: 'user.question',
    label: 'Ask you a question',
    description: 'Ask a multi-step question and wait for your answer.',
    permissionLabel: 'ask you a question',
    interactive: true,
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              prompt: { type: 'string' },
              suggestedAnswers: { type: 'array', items: { type: 'string' } },
              recommendedAnswer: { type: 'string' },
            },
            required: ['prompt'],
          },
        },
        customAnswerAllowed: { type: 'boolean' },
      },
      required: ['prompt', 'steps'],
      additionalProperties: false,
    },
  },
};

export function isAssistantToolName(value: unknown): value is AssistantToolName {
  return typeof value === 'string' && ASSISTANT_TOOL_NAMES.includes(value as AssistantToolName);
}
