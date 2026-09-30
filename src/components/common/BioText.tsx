import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { parseBioMarkdown } from '../../../common';
import type { BioFormat, BioInline } from '../../../common';
import { EmojiText } from './EmojiText';
import './BioText.css';

const HEADING_TAGS = { 1: 'h3', 2: 'h4', 3: 'h5' } as const;

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
        <a key={key} className="bio-text__link" href={inline.href} target="_blank" rel="noreferrer noopener">
          {renderInlines(inline.children, key)}
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

        if (block.kind === 'bullets' || block.kind === 'ordered') {
          const items = block.items.map((item, itemIndex) => (
            <li key={`item-${itemIndex}`} className="bio-text__listItem">
              {renderInlines(item, `${key}-item-${itemIndex}`)}
            </li>
          ));

          if (block.kind === 'ordered') {
            return (
              <ol key={key} className="bio-text__list bio-text__list--ordered">
                {items}
              </ol>
            );
          }

          return (
            <ul key={key} className="bio-text__list">
              {items}
            </ul>
          );
        }

        if (block.kind === 'heading') {
          const Heading = HEADING_TAGS[block.level];
          return (
            <Heading key={key} className={`bio-text__heading bio-text__heading--${block.level}`}>
              {renderInlines(block.inlines, key)}
            </Heading>
          );
        }

        if (block.kind === 'quote') {
          return (
            <blockquote key={key} className="bio-text__quote">
              {renderInlines(block.inlines, key)}
            </blockquote>
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
