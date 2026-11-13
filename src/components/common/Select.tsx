import { Children, useId, useEffect, useRef, useState, isValidElement } from 'react';
import type { ButtonHTMLAttributes, ChangeEvent, ReactNode, SelectHTMLAttributes } from 'react';
import './Select.css';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  helperText?: string;
  fullWidth?: boolean;
  options?: SelectOption[];
  children?: ReactNode;
  placeholder?: string;
}

function parseOptionChildren(children: ReactNode): SelectOption[] {
  const opts: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as { value?: unknown; children?: ReactNode };
    if (child.type !== 'option') return;
    const label = typeof props.children === 'string' ? props.children : String(props.children ?? '');
    opts.push({ value: String(props.value ?? label), label });
  });
  return opts;
}

export const Select = ({
  label,
  error,
  helperText,
  fullWidth = false,
  options,
  children,
  placeholder,
  className = '',
  value,
  onChange,
  disabled,
  ...props
}: SelectProps) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectId = useId();

  const resolvedOptions = options ?? parseOptionChildren(children);

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

  const selectedOption = resolvedOptions.find((opt) => String(opt.value) === String(value ?? ''));
  const display = selectedOption
    ? selectedOption.label
    : placeholder ?? resolvedOptions[0]?.label ?? 'Select';

  const handleSelect = (optValue: string) => {
    if (disabled) return;
    const synthetic = { target: { value: optValue } } as unknown as ChangeEvent<HTMLSelectElement>;
    onChange?.(synthetic);
    setOpen(false);
  };

  return (
    <div
      className={`select-wrapper ${fullWidth ? 'select-wrapper--full-width' : ''}`}
      ref={containerRef}
    >
      {label && <label className="select-label" htmlFor={selectId}>{label}</label>}
      <button
        type="button"
        id={selectId}
        className={`select ${error ? 'select--error' : ''} ${className}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        {...(props as unknown as ButtonHTMLAttributes<HTMLButtonElement>)}
        onClick={(e) => {
          if (disabled) return;
          (props as unknown as ButtonHTMLAttributes<HTMLButtonElement>)?.onClick?.(e);
          setOpen((v) => !v);
        }}
      >
        <span className="select__value">{display}</span>
        <span className="select__chevron" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="select__menu" role="listbox">
          {resolvedOptions.map((opt) => {
            const active = String(opt.value) === String(value ?? '');
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={active}
                className={`select__item ${active ? 'select__item--active' : ''}`}
                onClick={() => handleSelect(opt.value)}
                disabled={disabled}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
      {error && <span className="select-error">{error}</span>}
      {helperText && !error && <span className="select-helper">{helperText}</span>}
    </div>
  );
};