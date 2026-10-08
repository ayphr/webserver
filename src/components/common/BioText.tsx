import { useMemo } from 'react';
import { Markdown } from '../../../common';
import type { MarkdownFormat } from '../../../common';
import type { MarkdownFeature } from '../../lib/markdown';
import { MarkdownRenderer } from '../../lib/markdown';
import './BioText.css';

export interface BioTextProps {
  value: string;
  format?: MarkdownFormat;
  className?: string;
}

const BIO_FEATURES: MarkdownFeature[] = ['bold', 'italic', 'strike', 'code', 'codeBlock', 'lists'];

export const BioText = ({ value, format = 'limited', className }: BioTextProps) => {
  const markdown = useMemo(() => new Markdown(value, format === 'markdown'), [value, format]);

  if (!markdown.source) return null;

  return (
    <MarkdownRenderer
      markdown={markdown}
      features={BIO_FEATURES}
      className={`bio-text ${className ?? ''}`.trim()}
    />
  );
};
