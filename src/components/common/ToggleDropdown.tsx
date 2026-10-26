import { useState } from 'react';
import './ToggleDropdown.css';

export interface ToggleDropdownProps {
  label?: string;
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
}

export const ToggleDropdown = ({ label, options, value, onChange, placeholder = 'Select', className = '' }: ToggleDropdownProps) => {
  const [open, setOpen] = useState(false);

  const toggle = (opt: string) => {
    if (value.includes(opt)) {
      onChange(value.filter((v) => v !== opt));
    } else {
      onChange([...value, opt]);
    }
  };

  return (
    <div className={`toggle-dropdown ${className}`}>
      {label && <label className="toggle-dropdown__label">{label}</label>}
      <button type="button" className="toggle-dropdown__toggle" onClick={() => setOpen((v) => !v)}>
        {value.length ? value.join(', ') : placeholder} ▾
      </button>
      {open && (
        <div className="toggle-dropdown__menu">
          {options.map((opt) => (
            <label key={opt} className="toggle-dropdown__item">
              <input type="checkbox" checked={value.includes(opt)} onChange={() => toggle(opt)} />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  );
};
