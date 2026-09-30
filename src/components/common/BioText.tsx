import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { IconExternalLink } from '@tabler/icons-react';
import { parseBioMarkdown } from '../../../common';
import type { BioFormat, BioInline } from '../../../common';
import { EmojiText } from './EmojiText';
import './BioLink.css';
import './BioText.css';

function renderInlines(inlines: BioInline[], keyPrefix: string): ReactNode[] {
  return inlines.map((inline, index) => {
    const key = `${keyPrefix}-${index}`;

    if (inline.kind === 'text') {
      return <EmojiText key={key}>{inline.value}</EmojiText>;
    }

    if (inline.kind === 'code') {
      return (
        <code key={key} className="bio-text__code">
          {inline.value}
        </code>
      );
    }

    if (inline.kind === 'link') {
      return (
        <a key={key} className="bio-link" href={inline.href} target="_blank" rel="noreferrer noopener">
          {renderInlines(inline.children, key)}
          <IconExternalLink className="bio-link__icon" size={12} aria-hidden="true" />
        </a>
      );
    }

    if (inline.kind === 'bold') {
      return <strong key={key}>{renderInlines(inline.children, key)}</strong>;
    }

    if (inline.kind === 'italic') {
      return <em key={key}>{renderInlines(inline.children, key)}</em>;
    }

    return <del key={key}>{renderInlines(inline.children, key)}</del>;
  });
}

export interface BioTextProps {
  value: string;
  format?: BioFormat;
  className?: string;
}

export const BioText = ({ value, format = 'limited', className }: BioTextProps) => {
  const extended = format === 'markdown';
  const blocks = useMemo(() => parseBioMarkdown(value, extended), [value, extended]);

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className={`bio-text ${className ?? ''}`.trim()}>
      {blocks.map((block, index) => {
        const key = `block-${index}`;

        if (block.kind === 'codeBlock') {
          return (
            <pre key={key} className="bio-text__codeBlock">
              <code>{block.code}</code>
            </pre>
          );
        }

        if (block.kind === 'bullets') {
          return (
            <ul key={key} className="bio-text__list">
              {block.items.map((item, itemIndex) => (
                <li key={`item-${itemIndex}`} className="bio-text__listItem">
                  {renderInlines(item, `${key}-item-${itemIndex}`)}
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={key} className="bio-text__line">
            {renderInlines(block.inlines, key)}
          </p>
        );
      })}
    </div>
  );
};
