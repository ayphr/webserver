import './Checkbox.css';
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
  ...props
}: CheckboxProps) => {
  return (
    <div className="checkbox-wrapper">
      <label className={`checkbox ${error ? 'checkbox--error' : ''} ${className}`}>
        <input
          type="checkbox"
          className="checkbox__input"
          {...props}
        />
        <span className="checkbox__box" aria-hidden="true">
          <IconCheck size={12} strokeWidth={3.5} />
        </span>
        {label && <span className="checkbox__label">{label}</span>}
      </label>
      {error && <span className="checkbox__error">{error}</span>}
    </div>
  );
};
