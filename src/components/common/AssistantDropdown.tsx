import { useEffect, useRef, useState } from 'react';
import {
  IconRocket,
  IconCircle,
  IconSparkle,
  IconSparkle2,
  IconSparkleHighlight,
} from '@tabler/icons-react';
import { ASSISTANT_DATA, ASSISTANT_VARIANTS, type AssistantVariant } from '@common';
import { useDismiss } from '../../hooks/useDismiss';
import { Tooltip } from './Tooltip';
import { useTooltip } from '../../context';
import './AssistantDropdown.css';

export interface AssistantDropdownProps {
  value?: AssistantVariant;
  onChange?: (value: AssistantVariant) => void;
  label?: string;
  className?: string;
  disabled?: boolean;
  defaultVariant?: AssistantVariant;
  availableVariants?: AssistantVariant[];
}

const VARIANT_ICONS: Record<AssistantVariant, typeof IconCircle> = {
  nano: IconCircle,
  lite: IconSparkle,
  standard: IconSparkle2,
  plus: IconSparkleHighlight,
  turbo: IconRocket,
};

export const AssistantDropdown = ({
  value,
  onChange,
  label,
  className = '',
  disabled = false,
  defaultVariant = 'standard',
  availableVariants = ASSISTANT_VARIANTS,
}: AssistantDropdownProps) => {
  const [internal, setInternal] = useState<AssistantVariant>(value ?? defaultVariant ?? 'standard');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevOpenRef = useRef(false);
  const { hideTooltip } = useTooltip();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (value !== undefined) setInternal(value);
  }, [value]);

  useDismiss(
    containerRef,
    () => { setOpen(false); hideTooltip(); },
    { enabled: open },
  );

  useEffect(() => {
    if (prevOpenRef.current && !open) {
      hideTooltip();
    }
    prevOpenRef.current = open;
  }, [open, hideTooltip]);

  const current = internal;
  const CurrentIcon = VARIANT_ICONS[current];

  const handleSelect = (variant: AssistantVariant) => {
    if (disabled) return;
    setInternal(variant);
    onChange?.(variant);
    setOpen(false);
    hideTooltip();
  };

  return (
    <div className={`assistant-dropdown ${className}`} ref={containerRef}>
      {label && <label className="assistant-dropdown__label">{label}</label>}
      <button
        type="button"
        className="assistant-dropdown__toggle"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (disabled) return;
          if (open) hideTooltip();
          setOpen((v) => !v);
        }}
      >
        <span className="assistant-dropdown__value">
          <CurrentIcon
            size={16}
            className="assistant-dropdown__icon"
          />
          <span className="assistant-dropdown__name">{ASSISTANT_DATA[current].variantLabel}</span>
        </span>
      </button>
      {open && (
        <div className="assistant-dropdown__menu" role="listbox">
          {ASSISTANT_VARIANTS.filter((variant) => availableVariants.includes(variant)).map((variant) => {
            const Icon = VARIANT_ICONS[variant];
            const active = variant === current;
            return (
              <Tooltip key={variant} content={ASSISTANT_DATA[variant].modelLabel}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`assistant-dropdown__item ${active ? 'is-active' : ''}`}
                  onClick={() => handleSelect(variant)}
                  disabled={disabled}
                >
                  <Icon size={16} className="assistant-dropdown__icon" aria-hidden="true" />
                  <span className="assistant-dropdown__item-name">{ASSISTANT_DATA[variant].variantLabel}</span>
                </button>
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );
};