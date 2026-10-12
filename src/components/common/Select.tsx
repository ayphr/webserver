import './Select.css';
import type { ReactNode, SelectHTMLAttributes } from 'react';

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
}

export const Select = ({
  label,
  error,
  helperText,
  fullWidth = false,
  options,
  children,
  className = '',
  ...props
}: SelectProps) => {
  return (
    <div className={`select-wrapper ${fullWidth ? 'select-wrapper--full-width' : ''}`}>
      {label && <label className="select-label">{label}</label>}
      <select
        className={`select ${error ? 'select--error' : ''} ${className}`}
        {...props}
      >
        {options
          ? options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))
          : children}
      </select>
      {error && <span className="select-error">{error}</span>}
      {helperText && !error && <span className="select-helper">{helperText}</span>}
    </div>
  );
};
