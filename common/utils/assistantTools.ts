import {
  ALERT_LOGIC,
  ALERT_MAX_CONDITIONS,
  ALERT_MAX_REPEAT_MINUTES,
  ALERT_METRICS,
  ALERT_MIN_REPEAT_MINUTES,
  ALERT_OPERATORS,
  isAssistantToolName,
  type AlertCondition,
  type AlertLogic,
  type AssistantQuestionStep,
  type AssistantToolInput,
  type AssistantToolName,
} from '../types';

export type NormalizedAssistantToolInput = {
  name: AssistantToolName;
  limit: number;
  hours: number;
  deviceId?: string;
  locationId?: string;
  metric: string;
  displayName?: string;
  query?: string;
  level: string;
  event: string;
  filter: 'all' | 'unread';
  all: boolean;
  id?: string;
  minutes: number;
  logic?: AlertLogic;
  conditions?: AlertCondition[];
  integrationIds?: string[];
  repeatIntervalMinutes?: number;
  enabled?: boolean;
  question?: {
    prompt: string;
    steps: AssistantQuestionStep[];
    customAnswerAllowed: boolean;
  };
};

const text = (value: unknown, maxLength: number): string | undefined =>
  typeof value === 'string' && value.trim() && value.length <= maxLength
    ? value.trim()
    : undefined;

const boundedNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
};

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

const parseAlertConditions = (value: unknown): AlertCondition[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > ALERT_MAX_CONDITIONS) {
    throw new Error('an alert needs between 1 and 6 conditions');
  }
  return value.map((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error('invalid alert condition');
    }
    const condition = entry as Record<string, unknown>;
    if (
      typeof condition.metric !== 'string' ||
      !(ALERT_METRICS as readonly string[]).includes(condition.metric) ||
      typeof condition.operator !== 'string' ||
      !(ALERT_OPERATORS as readonly string[]).includes(condition.operator) ||
      typeof condition.value !== 'number' ||
      !Number.isFinite(condition.value)
    ) {
      throw new Error('invalid alert condition');
    }
    return {
      metric: condition.metric as AlertCondition['metric'],
      operator: condition.operator as AlertCondition['operator'],
      value: condition.value,
    };
  });
};

const parseIntegrationIds = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error('invalid integration list');
  }
  if (!value.every((id) => typeof id === 'string' && id.trim().length > 0)) {
    throw new Error('invalid integration list');
  }
  return [...new Set(value.map((id) => (id as string).trim()))];
};

const parseSteps = (value: unknown): AssistantQuestionStep[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 5) {
    throw new Error('user.question needs between 1 and 5 steps');
  }
  return value.map((raw, index) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('invalid question step');
    }
    const step = raw as Record<string, unknown>;
    const id = text(step.id, 80) ?? `step-${index + 1}`;
    const prompt = text(step.prompt, 300);
    if (!prompt) throw new Error('question step needs a prompt');
    const answers = Array.isArray(step.suggestedAnswers)
      ? step.suggestedAnswers
          .map((answer) => text(answer, 120))
          .filter((answer): answer is string => Boolean(answer))
      : [];
    if (answers.length < 2 || answers.length > 6) {
      throw new Error('each step needs 2 to 6 suggested answers');
    }
    const recommendedAnswer =
      typeof step.recommendedAnswer === 'string' && answers.includes(step.recommendedAnswer)
        ? step.recommendedAnswer
        : answers[0];
    return { id, prompt, suggestedAnswers: answers, recommendedAnswer };
  });
};

/** Validates untrusted tool arguments before anything is executed server-side. */
export function normalizeAssistantToolInput(
  name: unknown,
  input: AssistantToolInput,
): NormalizedAssistantToolInput {
  if (!isAssistantToolName(name)) throw new Error('unknown tool');
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  const normalized: NormalizedAssistantToolInput = {
    name,
    limit: boundedNumber(raw.limit, 20, 1, 100),
    hours: boundedNumber(raw.hours, 24, 1, 720),
    metric: text(raw.metric, 40) ?? 'all',
    level: oneOf(raw.level, ['all', 'info', 'warning', 'error'] as const, 'all'),
    event: oneOf(
      raw.event,
      [
        'all',
        'upload_success',
        'upload_error',
        'auth_error',
        'malformed_data',
        'rate_limited',
        'token_revoked',
      ] as const,
      'all',
    ),
    filter: oneOf(raw.filter, ['all', 'unread'] as const, 'all'),
    all: raw.all === true,
    minutes: boundedNumber(raw.minutes, 60, 0, 10_080),
  };

  const deviceId = text(raw.deviceId, 120);
  if (deviceId) normalized.deviceId = deviceId;

  const locationId = text(raw.locationId, 120);
  if (locationId) normalized.locationId = locationId;

  const displayName = text(raw.name, 120);
  if (displayName) normalized.displayName = displayName;

  const query = text(raw.query, 300);
  if (query) normalized.query = query;

  const id = text(raw.id, 160);
  if (id) normalized.id = id;

  if (name === 'help.search' && !normalized.query) {
    throw new Error('help.search needs a query');
  }
  if ((name === 'location.create' || name === 'device.rename') && !normalized.displayName) {
    throw new Error(`${name} needs a name`);
  }
  if (
    (name === 'alerts.mute' || name === 'alerts.delete' || name === 'alerts.test' || name === 'alerts.update') &&
    !normalized.id
  ) {
    throw new Error(`${name} needs an alert`);
  }
  if (name === 'notifications.read' && !normalized.all && !normalized.id) {
    throw new Error('notifications.read needs a notification or all');
  }

  if (name === 'alerts.create' || name === 'alerts.update') {
    if (name === 'alerts.create' && !normalized.displayName) {
      throw new Error('alerts.create needs a name');
    }
    if (raw.logic !== undefined) {
      normalized.logic = oneOf(raw.logic, ALERT_LOGIC, 'and');
    }
    if (raw.conditions !== undefined || name === 'alerts.create') {
      normalized.conditions = parseAlertConditions(raw.conditions);
    }
    if (raw.integrationIds !== undefined) {
      normalized.integrationIds = parseIntegrationIds(raw.integrationIds);
    } else if (name === 'alerts.create') {
      normalized.integrationIds = [];
    }
    if (raw.repeatIntervalMinutes !== undefined) {
      normalized.repeatIntervalMinutes = boundedNumber(
        raw.repeatIntervalMinutes,
        60,
        ALERT_MIN_REPEAT_MINUTES,
        ALERT_MAX_REPEAT_MINUTES,
      );
    } else if (name === 'alerts.create') {
      normalized.repeatIntervalMinutes = 60;
    }
    if (typeof raw.enabled === 'boolean') normalized.enabled = raw.enabled;
  }

  if (name === 'user.question') {
    const prompt = text(raw.prompt, 500);
    if (!prompt) throw new Error('user.question needs a prompt');
    normalized.question = {
      prompt,
      steps: parseSteps(raw.steps),
      customAnswerAllowed: raw.customAnswerAllowed !== false,
    };
  }

  return normalized;
}

const MUTATION_TOOL_NAMES = new Set<AssistantToolName>([
  'alerts.create',
  'alerts.update',
  'alerts.delete',
  'alerts.test',
  'alerts.mute',
  'location.create',
  'device.rename',
  'notifications.read',
]);

/** True for tools that change workspace state and should be audited. */
export const isAssistantMutationTool = (name: string): name is AssistantToolName =>
  MUTATION_TOOL_NAMES.has(name as AssistantToolName);

const previewText = (value: unknown, fallback: string) => {
  const cleaned = text(value, 120)?.trim();
  return cleaned || fallback;
};

const previewDevice = (input: Record<string, unknown>) =>
  previewText(input.displayName ?? input.deviceId, 'the selected device');

/**
 * Builds a short human-readable description of the exact change a tool would
 * make. Shown on the approval card so users know what they are allowing.
 */
export function describeAssistantToolChange(
  name: string,
  input: Record<string, unknown> = {},
): string | undefined {
  switch (name) {
    case 'alerts.create': {
      const conditionCount = Array.isArray(input.conditions) ? input.conditions.length : 0;
      return `Create alert “${previewText(input.name, 'Untitled alert')}” for ${previewDevice(input)} with ${conditionCount} condition${conditionCount === 1 ? '' : 's'}.`;
    }
    case 'alerts.update': {
      const changes = ['name', 'conditions', 'integrationIds', 'repeatIntervalMinutes', 'enabled']
        .filter((field) => input[field] !== undefined);
      const suffix = changes.length > 0 ? `: ${changes.join(', ')}` : '';
      return `Change alert ${previewText(input.id, 'the selected alert')}${suffix}.`;
    }
    case 'alerts.delete':
      return `Permanently delete alert ${previewText(input.id, 'the selected alert')}.`;
    case 'alerts.test':
      return `Send a test notification for alert ${previewText(input.id, 'the selected alert')}.`;
    case 'alerts.mute':
      return Number(input.minutes) === 0
        ? `Resume notifications for alert ${previewText(input.id, 'the selected alert')}.`
        : `Pause alert ${previewText(input.id, 'the selected alert')} for ${Number(input.minutes) || 60} minutes.`;
    case 'location.create':
      return `Add location “${previewText(input.name, 'Untitled location')}”.`;
    case 'device.rename':
      return `Rename ${previewDevice(input)} to “${previewText(input.name, 'a new name')}”.`;
    case 'notifications.read':
      return input.all === true
        ? 'Mark all notifications as read.'
        : `Mark notification ${previewText(input.id, 'the selected notification')} as read.`;
    default:
      return undefined;
  }
}
