import { useState } from 'react';
import './ListInput.css';

export interface ListInputProps {
  label?: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  addLabel?: string;
  className?: string;
}

export const ListInput = ({ label, value, onChange, placeholder, addLabel = 'Add', className = '' }: ListInputProps) => {
  const [draft, setDraft] = useState('');

  const updateAt = (index: number, next: string) => {
    const copy = [...value];
    copy[index] = next;
    onChange(copy);
  };

  const removeAt = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const addDraft = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange([...value, trimmed]);
    setDraft('');
  };

  return (
    <div className={`list-input ${className}`}>
      {label && <label className="list-input__label">{label}</label>}
      <div className="list-input__items">
        {value.map((item, idx) => (
          <div key={idx} className="list-input__row">
            <input
              className="list-input__input"
              value={item}
              placeholder={placeholder}
              onChange={(e) => updateAt(idx, e.target.value)}
            />
            <button type="button" className="list-input__remove" onClick={() => removeAt(idx)} aria-label="Remove">
              −
            </button>
          </div>
        ))}
      </div>
      <div className="list-input__add-row">
        <input
          className="list-input__input"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addDraft();
            }
          }}
        />
        <button type="button" className="list-input__add" onClick={addDraft}>
          {addLabel}
        </button>
      </div>
    </div>
  );
};
