import { useEffect, useRef, useState } from 'react';
import { IconCheck } from '@tabler/icons-react';
import './ToggleDropdown.css';

export interface ToggleDropdownProps {
  label?: string;
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
  buttonLabel?: string;
}

export const ToggleDropdown = ({ label, options, value, onChange, placeholder = 'Select', className = '', buttonLabel }: ToggleDropdownProps) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const toggle = (opt: string) => {
    if (value.includes(opt)) {
      onChange(value.filter((v) => v !== opt));
    } else {
      onChange([...value, opt]);
    }
  };

  return (
    <div className={`toggle-dropdown ${className} ${open ? 'is-open' : ''}`} ref={containerRef}>
      {label && <label className="toggle-dropdown__label">{label}</label>}
      <button type="button" className="toggle-dropdown__toggle" onClick={() => setOpen((v) => !v)}>
        {buttonLabel ?? (value.length ? value.join(', ') : placeholder)} ▾
      </button>
      {open && (
        <div className="toggle-dropdown__menu">
          {options.map((opt) => {
            const enabled = value.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                className={`toggle-dropdown__item ${enabled ? 'toggle-dropdown__item--active' : ''}`}
                onClick={() => toggle(opt)}
              >
                <span className={`toggle-dropdown__checkbox ${enabled ? 'is-checked' : ''}`}>
                  {enabled ? <IconCheck size={12} strokeWidth={3.5} /> : null}
                </span>
                {opt}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
