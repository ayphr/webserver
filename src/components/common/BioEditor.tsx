import { useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { BIO_MAX_LENGTH, bioVisibleLength, lexBioMarkdown } from '../../../common';
import type { BioToken } from '../../../common';
import './BioEditor.css';

function renderTokens(tokens: BioToken[], keyPrefix: string): ReactNode[] {
  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;

    if (token.kind === 'text') {
      return token.value;
    }

    if (token.kind === 'marker') {
      return (
        <span key={key} className="bio-editor__marker">
          {token.value}
        </span>
      );
    }

    if (token.kind === 'visibleMarker') {
      return (
        <span key={key} className="bio-editor__visibleMarker">
          {token.value}
        </span>
      );
    }

    if (token.kind === 'code') {
      return (
        <span key={key} className="bio-editor__code">
          <span className="bio-editor__marker">{token.open}</span>
          {token.value}
          <span className="bio-editor__marker">{token.close}</span>
        </span>
      );
    }

    if (token.kind === 'codeBlock') {
      return (
        <span key={key} className="bio-editor__code bio-editor__code--block">
          {token.value}
        </span>
      );
    }

    const Tag = token.kind === 'bold' ? 'strong' : token.kind === 'italic' ? 'em' : 'del';

    return (
      <Tag key={key}>
        <span className="bio-editor__marker">{token.open}</span>
        {renderTokens(token.children, key)}
        <span className="bio-editor__marker">{token.close}</span>
      </Tag>
    );
  });
}

export interface BioEditorProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  labelledBy?: string;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  markdown?: boolean;
}

export const BioEditor = ({
  value,
  onChange,
  id,
  labelledBy,
  placeholder = 'Tell people a little about yourself',
  disabled = false,
  maxLength = BIO_MAX_LENGTH,
  markdown = false,
}: BioEditorProps) => {
  const surfaceRef = useRef<HTMLTextAreaElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  const tokens = useMemo(() => lexBioMarkdown(value, markdown), [value, markdown]);
  const used = useMemo(() => bioVisibleLength(value, markdown), [value, markdown]);
  const isOverLimit = used > maxLength;

  const syncScroll = (top: number, left: number) => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.scrollTop = top;
    layer.scrollLeft = left;
  };

  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface) syncScroll(surface.scrollTop, surface.scrollLeft);
  }, [value, tokens]);

  return (
    <div className="bio-editor">
      <div className="bio-editor__wrap">
        <div ref={layerRef} className="bio-editor__layer" aria-hidden="true">
          {renderTokens(tokens, 'token')}
        </div>
        <textarea
          id={id}
          ref={surfaceRef}
          className="bio-editor__surface"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onScroll={(event) => syncScroll(event.currentTarget.scrollTop, event.currentTarget.scrollLeft)}
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
