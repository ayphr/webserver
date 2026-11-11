import { useRef } from 'react';
import './CodeInput.css';

export interface CodeInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
  inputMode?: 'numeric' | 'text';
  autoCapitalize?: 'none' | 'characters' | 'sentences' | 'words';
  /** Transform applied to each entered character (e.g. to uppercase). */
  transform?: (char: string) => string;
  /** Whether a character is allowed. Defaults to digits only. */
  accept?: (char: string) => boolean;
}

export const CodeInput = ({
  length = 6,
  value,
  onChange,
  disabled = false,
  autoFocus = false,
  ariaLabel = 'Verification code',
  inputMode = 'numeric',
  autoCapitalize = 'none',
  transform = (c) => c,
  accept = (c) => /[0-9]/.test(c),
}: CodeInputProps) => {
  const inputRefs = useRef<HTMLInputElement[]>([]);

  const chars: string[] = [];
  for (let i = 0; i < length; i += 1) chars.push(value[i] ?? '');

  const setCodeAt = (index: number, char: string) => {
    const arr = value.split('');
    while (arr.length < length) arr.push('');
    arr[index] = char;
    onChange(arr.join('').slice(0, length));
  };

  const applyPaste = (startIndex: number, text: string) => {
    const cleaned = text
      .split('')
      .map((c) => transform(c))
      .filter((c) => accept(c))
      .join('')
      .slice(0, length);
    const arr = value.split('');
    while (arr.length < length) arr.push('');
    for (let i = 0; i < cleaned.length; i += 1) {
      const idx = startIndex + i;
      if (idx < length) arr[idx] = cleaned[i];
    }
    onChange(arr.join('').slice(0, length));
    const nextFocus = Math.min(startIndex + cleaned.length, length - 1);
    inputRefs.current[nextFocus]?.focus();
  };

  const handleChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const transformed = raw.split('').map((c) => transform(c)).join('');
    const val = transformed.split('').filter((c) => accept(c)).join('');
    if (val.length > 1) {
      applyPaste(index, raw);
      return;
    }
    if (val.length === 1) {
      setCodeAt(index, val);
      if (index < length - 1) inputRefs.current[index + 1]?.focus();
    } else if (raw === '') {
      setCodeAt(index, '');
    }
  };

  const handlePaste = (index: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    applyPaste(index, e.clipboardData.getData('text'));
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !(inputRefs.current[index]?.value) && index > 0) {
      setCodeAt(index - 1, '');
      inputRefs.current[index - 1]?.focus();
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  return (
    <div className="code-input" role="group" aria-label={ariaLabel}>
      {chars.map((char, i) => (
        <input
          key={i}
          ref={(el) => { if (el) inputRefs.current[i] = el; }}
          className="code-input__box"
          type="text"
          inputMode={inputMode}
          autoCapitalize={autoCapitalize}
          autoComplete="one-time-code"
          maxLength={1}
          value={char}
          onChange={(e) => handleChange(i, e)}
          onPaste={(e) => handlePaste(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          aria-label={`Character ${i + 1}`}
        />
      ))}
    </div>
  );
};