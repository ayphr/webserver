import './Checkbox.css';
import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { IconCheck } from '@tabler/icons-react';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
  error?: string;
}

export const Checkbox = ({
  label,
  error,
  className = '',
  id,
  ...props
}: CheckboxProps) => {
  const generatedId = useId();
  const checkboxId = id ?? generatedId;
  const errorId = `${checkboxId}-error`;
  const describedBy = [error && errorId, props['aria-describedby']]
    .filter(Boolean)
    .join(' ') || undefined;

  return (
    <div className="checkbox-wrapper">
      <label className={`checkbox ${error ? 'checkbox--error' : ''} ${className}`} htmlFor={checkboxId}>
        <input
          {...props}
          id={checkboxId}
          type="checkbox"
          className="checkbox__input"
          aria-invalid={Boolean(error) || props['aria-invalid']}
          aria-describedby={describedBy}
        />
        <span className="checkbox__box" aria-hidden="true">
          <IconCheck size={12} strokeWidth={3.5} />
        </span>
        {label && <span className="checkbox__label">{label}</span>}
      </label>
      {error && <span className="checkbox__error" id={errorId} role="alert">{error}</span>}
    </div>
  );
};
