import type { ReactNode } from 'react';
import type { Markdown, MarkdownBlock, MarkdownInline } from '../../common';

export type MarkdownFeature =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'codeBlock'
  | 'lists'
  | 'headings';

export interface MarkdownRendererProps {
  markdown: Markdown;
  features?: MarkdownFeature[];
  className?: string;
}

const ALL_FEATURES: MarkdownFeature[] = ['bold', 'italic', 'strike', 'code', 'codeBlock', 'lists', 'headings'];

function renderInlines(
  inlines: MarkdownInline[],
  keyPrefix: string,
  features: MarkdownFeature[]
): ReactNode[] {
  return inlines.map((inline, index) => {
    const key = `${keyPrefix}-${index}`;

    if (inline.kind === 'text') {
      return <span key={key}>{inline.value}</span>;
    }

    if (inline.kind === 'code') {
      if (!features.includes('code')) {
        return <span key={key}>{inline.value}</span>;
      }
      return (
        <code key={key}>
          {inline.value}
        </code>
      );
    }

    if (inline.kind === 'bold') {
      if (!features.includes('bold')) {
        return <span key={key}>{renderInlines(inline.children, key, features)}</span>;
      }
      return <strong key={key}>{renderInlines(inline.children, key, features)}</strong>;
    }

    if (inline.kind === 'italic') {
      if (!features.includes('italic')) {
        return <span key={key}>{renderInlines(inline.children, key, features)}</span>;
      }
      return <em key={key}>{renderInlines(inline.children, key, features)}</em>;
    }

    if (inline.kind === 'strike') {
      if (!features.includes('strike')) {
        return <span key={key}>{renderInlines(inline.children, key, features)}</span>;
      }
      return <del key={key}>{renderInlines(inline.children, key, features)}</del>;
    }

    return null;
  });
}

function getHeadingLevel(text: string): number | null {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('######')) return 6;
  if (trimmed.startsWith('#####')) return 5;
  if (trimmed.startsWith('####')) return 4;
  if (trimmed.startsWith('###')) return 3;
  if (trimmed.startsWith('##')) return 2;
  if (trimmed.startsWith('#')) return 1;
  return null;
}

function stripHeading(text: string): string {
  const trimmed = text.trimStart();
  const match = new RegExp(/^(#{1,6})\s*(.*)$/).exec(trimmed);
  if (match) return match[2] || '';
  return text;
}

function renderBlocks(blocks: MarkdownBlock[], features: MarkdownFeature[], keyPrefix: string = 'block'): ReactNode[] {
  const elements: ReactNode[] = [];

  blocks.forEach((block, index) => {
    const key = `${keyPrefix}-${index}`;

    if (block.kind === 'codeBlock') {
      if (!features.includes('codeBlock')) {
        elements.push(<pre key={key}>{block.code}</pre>);
        return;
      }
      elements.push(
        <pre key={key}>
          <code>{block.code}</code>
        </pre>
      );
      return;
    }

    if (block.kind === 'bullets') {
      if (!features.includes('lists')) {
        block.items.forEach((item, itemIndex) => {
          const inlines = renderInlines(item, `${key}-item-${itemIndex}`, features);
          if (inlines.length > 0) elements.push(<div key={key}>{inlines}</div>);
        });
        return;
      }
      elements.push(
        <ul key={key}>
          {block.items.map((item, itemIndex) => (
            <li key={`item-${itemIndex}`}>
              {renderInlines(item, `${key}-item-${itemIndex}`, features)}
            </li>
          ))}
        </ul>
      );
      return;
    }

    const inlines = renderInlines(block.inlines, key, features);
    if (inlines.length === 0) return;

    if (features.includes('headings')) {
      const fullText = block.inlines
        .map((inline) => (inline.kind === 'text' ? inline.value : ''))
        .join('');
      const level = getHeadingLevel(fullText);
      if (level) {
        const stripped = stripHeading(fullText);
        const strippedInlines = renderInlines([{ kind: 'text', value: stripped }], key, features);
        const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
        elements.push(<Tag key={key}>{strippedInlines}</Tag>);
        return;
      }
    }

    elements.push(<p key={key}>{inlines}</p>);
  });

  return elements;
}

export function MarkdownRenderer({ markdown, features = ALL_FEATURES, className }: Readonly<MarkdownRendererProps>) {
  const blocks = markdown.blocks();

  if (blocks.length === 0) {
    return null;
  }

  return <div className={className}>{renderBlocks(blocks, features)}</div>;
}
