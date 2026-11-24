import { useEffect, useRef, useState } from 'react';
import './CodeInput.css';

export interface CodeInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
}

/** Keeps empty slots in place while still emitting a compact digit string. */
function toSlots(value: string, length: number): string[] {
  return Array.from({ length }, (_, index) => value[index] ?? '');
}

export const CodeInput = ({
  length = 6,
  value,
  onChange,
  disabled = false,
  autoFocus = false,
  ariaLabel = 'Verification code',
}: CodeInputProps) => {
  const inputRefs = useRef<HTMLInputElement[]>([]);
  const lastEmitted = useRef(value);
  const [slots, setSlots] = useState<string[]>(() => toSlots(value, length));

  // Only resynchronise when the parent changes the value to something we did not emit.
  // This preserves empty middle slots while typing, without fighting parent updates.
  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    setSlots(toSlots(value, length));
  }, [value, length]);

  const commit = (next: string[]) => {
    setSlots(next);
    const compact = next.join('');
    lastEmitted.current = compact;
    onChange(compact);
  };

  const setSlotAt = (index: number, char: string) => {
    const next = slots.slice();
    next[index] = char;
    commit(next);
  };

  const applyPaste = (startIndex: number, text: string) => {
    const cleaned = text.replace(/\D/g, '').slice(0, length);
    if (!cleaned) return;
    const next = slots.slice();
    for (let i = 0; i < cleaned.length; i += 1) {
      const index = startIndex + i;
      if (index < length) next[index] = cleaned.charAt(i);
    }
    commit(next);
    const nextFocus = Math.min(startIndex + cleaned.length, length - 1);
    inputRefs.current[nextFocus]?.focus();
  };

  const handleChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const digit = e.target.value.replace(/\D/g, '').slice(-1);
    if (e.target.value.replace(/\D/g, '').length > 1) {
      applyPaste(index, e.target.value);
      return;
    }
    setSlotAt(index, digit);
    if (digit && index < length - 1) inputRefs.current[index + 1]?.focus();
  };

  const handlePaste = (index: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    applyPaste(index, e.clipboardData.getData('text'));
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (slots[index]) {
        setSlotAt(index, '');
      } else if (index > 0) {
        setSlotAt(index - 1, '');
        inputRefs.current[index - 1]?.focus();
      }
    } else if (e.key === 'Delete') {
      e.preventDefault();
      setSlotAt(index, '');
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  return (
    <div className="code-input" role="group" aria-label={ariaLabel}>
      {slots.map((digit, i) => (
        <input
          key={i}
          ref={(el) => { if (el) inputRefs.current[i] = el; }}
          className="code-input__box"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={1}
          value={digit}
          onChange={(e) => handleChange(i, e)}
          onPaste={(e) => handlePaste(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          aria-label={`Digit ${i + 1} of ${length}`}
        />
      ))}
    </div>
  );
};
