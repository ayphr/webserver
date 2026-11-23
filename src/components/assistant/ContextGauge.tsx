import { useRef, useState } from 'react';
import { useDismiss } from '../../hooks/useDismiss';
import { formatTokenCount, type AssistantContextUsage } from '@common';
import '../common/Select.css';
import './ContextGauge.css';

export interface ContextGaugeProps {
  usage?: AssistantContextUsage;
  onCompact: () => void;
  disabled?: boolean;
}

const RADIUS = 8;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const levelFor = (ratio: number): 'low' | 'medium' | 'high' =>
  ratio >= 0.9 ? 'high' : ratio >= 0.7 ? 'medium' : 'low';

export const ContextGauge = ({ usage, onCompact, disabled = false }: ContextGaugeProps) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useDismiss(containerRef, () => setOpen(false), { enabled: open });

  const ratio = Math.max(0, Math.min(1, usage?.ratio ?? 0));
  const level = levelFor(ratio);
  const percent = Math.round(ratio * 100);

  return (
    <div className="context-gauge" ref={containerRef}>
      <button
        type="button"
        className={`context-gauge__trigger context-gauge__trigger--${level}`}
        aria-label={`Context usage ${percent} percent. Open details.`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!usage}
        onClick={() => setOpen((value) => !value)}
      >
        <svg className="context-gauge__ring" viewBox="0 0 20 20" aria-hidden="true">
          <circle className="context-gauge__track" cx="10" cy="10" r={RADIUS} />
          <circle
            className="context-gauge__fill"
            cx="10"
            cy="10"
            r={RADIUS}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - ratio)}
          />
        </svg>
      </button>

      {open && usage && (
        <div className="select__menu context-gauge__menu" role="dialog" aria-label="Context usage">
          <div className="context-gauge__header">
            <span className="context-gauge__title">Context usage</span>
            <span className={`context-gauge__percent context-gauge__percent--${level}`}>
              {percent}%
            </span>
          </div>

          <p className="context-gauge__model">{usage.modelLabel}</p>

          <div className="context-gauge__bar" aria-hidden="true">
            <span
              className={`context-gauge__bar-fill context-gauge__bar-fill--${level}`}
              style={{ width: `${percent}%` }}
            />
          </div>

          <dl className="context-gauge__stats">
            <div>
              <dt>Used</dt>
              <dd>{formatTokenCount(usage.usedTokens)} tokens</dd>
            </div>
            <div>
              <dt>Input budget</dt>
              <dd>{formatTokenCount(usage.budgetTokens)} tokens</dd>
            </div>
            <div>
              <dt>Model window</dt>
              <dd>{formatTokenCount(usage.contextWindowTokens)} tokens</dd>
            </div>
            <div>
              <dt>Reserved output</dt>
              <dd>{formatTokenCount(usage.maxOutputTokens)} tokens</dd>
            </div>
            <div>
              <dt>Messages in context</dt>
              <dd>
                {usage.includedMessageCount} of {usage.messageCount}
              </dd>
            </div>
            <div>
              <dt>Compacted</dt>
              <dd>
                {usage.compactedMessageCount} messages
                {usage.summaryTokens > 0 ? ` · ${formatTokenCount(usage.summaryTokens)} tokens` : ''}
              </dd>
            </div>
          </dl>

          <p className="context-gauge__hint">
            Older messages are summarized automatically at {Math.round(usage.thresholdRatio * 100)}%
            usage.
          </p>

          <button
            type="button"
            className="select__item context-gauge__action"
            disabled={disabled}
            onClick={() => {
              onCompact();
              setOpen(false);
            }}
          >
            Compact now
          </button>
        </div>
      )}
    </div>
  );
};
