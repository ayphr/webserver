import { useState } from 'react';
import { IconArrowRight, IconCheck } from '@tabler/icons-react';
import type { AssistantUserQuestion } from '@common';
import './UserQuestionCard.css';

export interface UserQuestionCardProps {
  question: AssistantUserQuestion;
  onSubmit: (answers: Record<string, string>, customAnswer?: string) => void;
  disabled?: boolean;
}

export const UserQuestionCard = ({ question, onSubmit, disabled = false }: UserQuestionCardProps) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      question.steps.map((step) => [step.id, step.recommendedAnswer ?? step.suggestedAnswers[0] ?? '']),
    ),
  );
  const [customs, setCustoms] = useState<Record<string, string>>({});

  const step = question.steps[stepIndex];
  if (!step) return null;
  const isLast = stepIndex === question.steps.length - 1;
  const custom = customs[step.id] ?? '';

  const submit = () => {
    const finalAnswers = { ...answers };
    for (const [id, value] of Object.entries(customs)) {
      if (value.trim()) finalAnswers[id] = value.trim();
    }
    onSubmit(finalAnswers, custom.trim() || undefined);
  };

  return (
    <div className="user-question-card">
      <p className="user-question-card__prompt">{question.prompt}</p>
      {question.steps.length > 1 && (
        <p className="user-question-card__progress">
          Step {stepIndex + 1} of {question.steps.length}
        </p>
      )}
      <p className="user-question-card__step">{step.prompt}</p>
      <div className="user-question-card__answers" role="group" aria-label={step.prompt}>
        {step.suggestedAnswers.map((answer) => {
          const selected = !custom && answers[step.id] === answer;
          return (
            <button
              key={answer}
              type="button"
              className={`user-question-card__answer ${selected ? 'user-question-card__answer--selected' : ''}`}
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => {
                setAnswers((previous) => ({ ...previous, [step.id]: answer }));
                setCustoms((previous) => ({ ...previous, [step.id]: '' }));
              }}
            >
              {answer}
              {step.recommendedAnswer === answer && (
                <span className="user-question-card__recommended">Recommended</span>
              )}
            </button>
          );
        })}
      </div>
      {question.customAnswerAllowed && (
        <label className="user-question-card__custom">
          <span>Or type your own answer</span>
          <input
            type="text"
            value={custom}
            maxLength={300}
            disabled={disabled}
            placeholder="Your answer"
            onChange={(event) =>
              setCustoms((previous) => ({ ...previous, [step.id]: event.target.value }))
            }
          />
        </label>
      )}
      <div className="user-question-card__actions">
        {stepIndex > 0 && (
          <button
            type="button"
            className="user-question-card__back"
            disabled={disabled}
            onClick={() => setStepIndex((index) => index - 1)}
          >
            Back
          </button>
        )}
        <button
          type="button"
          className="user-question-card__next"
          disabled={disabled || (!custom && !answers[step.id])}
          onClick={() => {
            if (isLast) submit();
            else setStepIndex((index) => index + 1);
          }}
        >
          {isLast ? (
            <>
              <IconCheck size={14} strokeWidth={2} /> Send answer
            </>
          ) : (
            <>
              Next <IconArrowRight size={14} strokeWidth={2} />
            </>
          )}
        </button>
      </div>
    </div>
  );
};
