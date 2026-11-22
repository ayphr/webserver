import './Input.css';
import { useId, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { IconEye, IconEyeOff } from '@tabler/icons-react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  fullWidth?: boolean;
  /** Adds a show/hide toggle for password fields. */
  revealable?: boolean;
}

export const Input = ({
  label,
  error,
  helperText,
  fullWidth = false,
  revealable = false,
  className = '',
  id,
  type = 'text',
  ...props
}: InputProps) => {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [revealed, setRevealed] = useState(false);
  const isRevealable = revealable && type === 'password';
  const describedBy = [error && `${inputId}-error`, helperText && `${inputId}-helper`]
    .filter(Boolean)
    .join(' ') || undefined;

  return (
    <div className={`input-wrapper ${fullWidth ? 'input-wrapper--full-width' : ''}`}>
      {label && <label className="input-label" htmlFor={inputId}>{label}</label>}
      <div className="input-control">
        <input
          id={inputId}
          className={`input ${error ? 'input--error' : ''} ${isRevealable ? 'input--revealable' : ''} ${className}`}
          type={isRevealable && revealed ? 'text' : type}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          {...props}
        />
        {isRevealable && (
          <button
            type="button"
            className="input__reveal"
            onClick={() => setRevealed((value) => !value)}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            aria-pressed={revealed}
          >
            {revealed ? <IconEyeOff size={18} strokeWidth={1.7} /> : <IconEye size={18} strokeWidth={1.7} />}
          </button>
        )}
      </div>
      {error && <span className="input-error" id={`${inputId}-error`} role="alert">{error}</span>}
      {helperText && <span className="input-helper" id={`${inputId}-helper`}>{helperText}</span>}
    </div>
  );
};