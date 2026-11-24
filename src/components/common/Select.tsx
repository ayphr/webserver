import { Children, useId, isValidElement } from 'react';
import type { ReactNode, SelectHTMLAttributes } from 'react';
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

/** A native select gives us correct listbox, typeahead and keyboard behaviour for free. */
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
  ...props
}: SelectProps) => {
  const generatedId = useId();
  const selectId = props.id ?? generatedId;
  const resolvedOptions = options ?? parseOptionChildren(children);
  const hasEmptyOption = resolvedOptions.some((option) => option.value === '');
  const describedBy = [
    error && `${selectId}-error`,
    helperText && `${selectId}-helper`,
    props['aria-describedby'],
  ].filter(Boolean).join(' ') || undefined;

  return (
    <div
      className={`select-wrapper ${fullWidth ? 'select-wrapper--full-width' : ''}`}
    >
      {label && <label className="select-label" htmlFor={selectId}>{label}</label>}
      <div className="select-control">
        <select
          {...props}
          id={selectId}
          className={`select ${error ? 'select--error' : ''} ${className}`}
          value={value ?? ''}
          aria-invalid={Boolean(error) || props['aria-invalid']}
          aria-describedby={describedBy}
        >
          {placeholder && !hasEmptyOption && (
            <option value="" disabled>{placeholder}</option>
          )}
          {resolvedOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <span className="select__chevron" aria-hidden="true">▾</span>
      </div>
      {error && <span className="select-error" id={`${selectId}-error`} role="alert">{error}</span>}
      {helperText && !error && <span className="select-helper" id={`${selectId}-helper`}>{helperText}</span>}
    </div>
  );
};
