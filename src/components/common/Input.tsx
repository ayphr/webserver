import './Input.css';
import { useId } from 'react';
import type { InputHTMLAttributes } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  fullWidth?: boolean;
}

export const Input = ({
  label,
  error,
  helperText,
  fullWidth = false,
  className = '',
  id,
  ...props
}: InputProps) => {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className={`input-wrapper ${fullWidth ? 'input-wrapper--full-width' : ''}`}>
      {label && <label className="input-label" htmlFor={inputId}>{label}</label>}
      <input
        id={inputId}
        className={`input ${error ? 'input--error' : ''} ${className}`}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${inputId}-error` : undefined}
        {...props}
      />
      {error && <span className="input-error" id={`${inputId}-error`}>{error}</span>}
      {helperText && !error && <span className="input-helper">{helperText}</span>}
    </div>
  );
};
