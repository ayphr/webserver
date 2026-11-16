import { BIO_MAX_LENGTH } from '@common';
import './BioEditor.css';

export interface BioEditorProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  labelledBy?: string;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
}

export const BioEditor = ({
  value,
  onChange,
  id,
  labelledBy,
  placeholder = 'Tell people a little about yourself',
  disabled = false,
  maxLength = BIO_MAX_LENGTH,
}: BioEditorProps) => {
  const used = value.length;
  const isOverLimit = used > maxLength;

  return (
    <div className="bio-editor">
      <div className="bio-editor__wrap">
        <textarea
          id={id}
          className="bio-editor__surface"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          rows={4}
          spellCheck
          wrap="soft"
          placeholder={placeholder}
          aria-labelledby={labelledBy}
          aria-describedby={id ? `${id}-counter` : undefined}
        />
      </div>

      <div className="bio-editor__footer">
        <span
          id={id ? `${id}-counter` : undefined}
          className={`bio-editor__counter ${isOverLimit ? 'is-over' : ''}`}
        >
          {used}/{maxLength}
        </span>
      </div>
    </div>
  );
};