import { useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { IconCheck } from '@tabler/icons-react';
import { useDismiss } from '../../hooks/useDismiss';
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<HTMLButtonElement[]>([]);
  const id = useId();
  const labelId = `${id}-label`;
  const menuId = `${id}-menu`;

  useDismiss(containerRef, () => setOpen(false), { enabled: open, escape: false });

  const toggle = (opt: string) => {
    if (value.includes(opt)) {
      onChange(value.filter((v) => v !== opt));
    } else {
      onChange([...value, opt]);
    }
  };

  const openAndFocus = () => {
    setOpen(true);
    requestAnimationFrame(() => itemRefs.current[0]?.focus());
  };

  const closeAndFocus = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const handleButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openAndFocus();
    }
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter(Boolean);
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAndFocus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
    if (event.key === 'ArrowUp') next = current <= 0 ? items.length - 1 : current - 1;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = items.length - 1;
    items[next]?.focus();
  };

  return (
    <div className={`toggle-dropdown ${className}`} ref={containerRef}>
      {label && <label className="toggle-dropdown__label" id={labelId} htmlFor={`${id}-button`}>{label}</label>}
      <button
        ref={buttonRef}
        id={`${id}-button`}
        type="button"
        className="toggle-dropdown__toggle"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => (open ? setOpen(false) : openAndFocus())}
        onKeyDown={handleButtonKeyDown}
      >
        {buttonLabel ?? (value.length ? value.join(', ') : placeholder)} ▾
      </button>
      {open && (
        <div
          className="toggle-dropdown__menu"
          id={menuId}
          role="menu"
          aria-labelledby={label ? labelId : `${id}-button`}
          onKeyDown={handleMenuKeyDown}
        >
          {options.map((opt, index) => {
            const enabled = value.includes(opt);
            return (
              <button
                key={opt}
                ref={(el) => { if (el) itemRefs.current[index] = el; }}
                type="button"
                role="menuitemcheckbox"
                aria-checked={enabled}
                className={`toggle-dropdown__item ${enabled ? 'toggle-dropdown__item--active' : ''}`}
                onClick={() => toggle(opt)}
              >
                <span className={`toggle-dropdown__checkbox ${enabled ? 'is-checked' : ''}`} aria-hidden="true">
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
