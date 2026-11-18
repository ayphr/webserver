import { useEffect, useRef, useState } from 'react';
import {
  IconRocket,
  IconCircle,
  IconSparkle,
  IconSparkle2,
  IconSparkleHighlight,
} from '@tabler/icons-react';
import { ASSISTANT_DATA, ASSISTANT_VARIANTS, type AssistantVariant } from '@common';
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

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        hideTooltip();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, hideTooltip]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        hideTooltip();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, hideTooltip]);

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
      <svg className="assistant-dropdown__gradient-defs" aria-hidden="true" width="0" height="0">
        <defs>
          <linearGradient id="turbo-rocket-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop className="turbo-gradient-stop turbo-gradient-stop--a" offset="0%" />
            <stop className="turbo-gradient-stop turbo-gradient-stop--b" offset="50%" />
            <stop className="turbo-gradient-stop turbo-gradient-stop--c" offset="100%" />
          </linearGradient>
        </defs>
      </svg>
      {label && <label className="assistant-dropdown__label">{label}</label>}
      <button
        type="button"
        className={`assistant-dropdown__toggle ${current === 'turbo' ? 'assistant-dropdown__toggle--turbo' : ''}`}
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
            className={`assistant-dropdown__icon ${current === 'turbo' ? 'assistant-dropdown__icon--turbo' : ''}`}
          />
          <span className="assistant-dropdown__name">{ASSISTANT_DATA[current].variantLabel}</span>
        </span>
        <span className="select__chevron" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="select__menu assistant-dropdown__menu" role="listbox">
          {ASSISTANT_VARIANTS.filter((variant) => availableVariants.includes(variant)).map((variant) => {
            const Icon = VARIANT_ICONS[variant];
            const active = variant === current;
            return (
              <Tooltip key={variant} content={ASSISTANT_DATA[variant].modelLabel}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`select__item assistant-dropdown__item ${active ? 'select__item--active' : ''}`}
                  onClick={() => handleSelect(variant)}
                  disabled={disabled}
                >
                  <Icon
                    size={16}
                    className={`assistant-dropdown__icon ${variant === 'turbo' ? 'assistant-dropdown__icon--turbo' : ''}`}
                  />
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