import { useEffect, useRef, useState } from 'react';
import {
  IconRocket,
  IconCircle,
  IconSparkle,
  IconSparkle2,
  IconSparkleHighlight,
} from '@tabler/icons-react';
import type { AssistantVariants } from '@common';
import './AssistantDropdown.css';

export interface AssistantDropdownProps {
  value?: AssistantVariants;
  onChange?: (value: AssistantVariants) => void;
  label?: string;
  className?: string;
  disabled?: boolean;
  defaultVariant?: AssistantVariants;
}

const VARIANTS: AssistantVariants[] = ['nano', 'lite', 'standard', 'plus', 'turbo'];

const VARIANT_LABELS: Record<AssistantVariants, string> = {
  nano: 'Nano',
  lite: 'Lite',
  standard: 'Standard',
  plus: 'Plus',
  turbo: 'Turbo',
};

const VARIANT_ICONS: Record<AssistantVariants, typeof IconCircle> = {
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
}: AssistantDropdownProps) => {
  const [internal, setInternal] = useState<AssistantVariants>(value ?? defaultVariant ?? 'standard');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (value !== undefined) setInternal(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const current = internal;
  const CurrentIcon = VARIANT_ICONS[current];

  const handleSelect = (variant: AssistantVariants) => {
    if (disabled) return;
    setInternal(variant);
    onChange?.(variant);
    setOpen(false);
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
          setOpen((v) => !v);
        }}
      >
        <span className="assistant-dropdown__value">
          <CurrentIcon size={16} className="assistant-dropdown__icon" />
          <span className="assistant-dropdown__name">{VARIANT_LABELS[current]}</span>
        </span>
        <span className="select__chevron" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="select__menu assistant-dropdown__menu" role="listbox">
          {VARIANTS.map((variant) => {
            const Icon = VARIANT_ICONS[variant];
            const active = variant === current;
            return (
              <button
                key={variant}
                type="button"
                role="option"
                aria-selected={active}
                className={`select__item assistant-dropdown__item ${active ? 'select__item--active' : ''}`}
                onClick={() => handleSelect(variant)}
                disabled={disabled}
              >
                <Icon size={16} className="assistant-dropdown__icon" />
                <span className="assistant-dropdown__item-name">{VARIANT_LABELS[variant]}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
