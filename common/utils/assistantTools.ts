import {
  isAssistantToolName,
  type AssistantQuestionStep,
  type AssistantToolInput,
  type AssistantToolName,
} from '../types';

export type NormalizedAssistantToolInput = {
  name: AssistantToolName;
  limit: number;
  hours: number;
  deviceId?: string;
  metric: string;
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
  };

  const deviceId = text(raw.deviceId, 120);
  if (deviceId) normalized.deviceId = deviceId;

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
