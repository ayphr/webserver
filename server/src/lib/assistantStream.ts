import type {
  AssistantMode,
  AssistantThinkingStep,
  AssistantToolCall,
} from '@common';

export type AssistantMockStream = {
  content: string;
  tokens: string[];
  thinking: AssistantThinkingStep[];
  tools: AssistantToolCall[];
};

const CHAT_RESPONSE = [
  '### Short answer',
  '',
  'I would start with **one clear next step**, then validate it with a small test.',
  '',
  '- Keep the scope tight',
  '- Measure the result',
  '- Iterate from the evidence',
  '',
  '> Tip: write the decision down so you can revisit it later.',
  '',
  '```ts',
  'const nextStep = "ship a small version";',
  'console.log(nextStep);',
  '```',
  '',
  'Use `inline code` for exact values, ~~discarded ideas~~ for context, and [references](https://example.com) when needed.',
  '',
  '| Option | Tradeoff |',
  '| --- | --- |',
  '| Fast | Less polish |',
  '| Careful | Slower |',
].join('\n');

const TASK_RESPONSE = [
  '## Project plan',
  '',
  'Here is a practical path for **long-horizon work**:',
  '',
  '1. Define the outcome and the constraints.',
  '2. Map the dependencies and owners.',
  '3. Ship a small slice and measure it.',
  '4. Review the result and adjust the plan.',
  '',
  '### Risks',
  '',
  '- Unclear scope can slow the first milestone.',
  '- Missing feedback loops hide problems until late.',
  '',
  '> Keep the plan visible and update it after each checkpoint.',
  '',
  '```txt',
  ' outcome -> dependencies -> slice -> review -> adjust ',
  '```',
  '',
  'This keeps the work **measurable**, `reversible`, and easy to hand over.',
].join('\n');

export const createAssistantMockStream = (mode: AssistantMode): AssistantMockStream => {
  const content = mode === 'task' ? TASK_RESPONSE : CHAT_RESPONSE;

  return {
    content,
    // Keep whitespace attached to the preceding token so clients can rebuild
    // the exact markdown response by appending tokens in order.
    tokens: content.match(/\S+\s*/g) ?? [],
    thinking: [
      {
        id: 'understand',
        title: 'Understanding the request',
        detail: mode === 'task' ? 'Long-horizon work' : 'Quick question',
        status: 'done',
      },
      {
        id: 'structure',
        title: 'Choosing a response structure',
        detail: mode === 'task' ? 'Plan and risks' : 'Answer and examples',
        status: 'running',
      },
      {
        id: 'constraints',
        title: 'Checking constraints',
        status: 'pending',
      },
    ],
    tools: [
      {
        id: 'context',
        name: 'context.search',
        status: 'done',
        detail: 'Checked recent conversation context',
        durationMs: 84,
      },
      {
        id: 'format',
        name: 'response.format',
        status: 'running',
        detail: 'Formatting markdown response',
      },
    ],
  };
};
