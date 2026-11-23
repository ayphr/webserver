import { isValidElement, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { IconCheck, IconCopy } from '@tabler/icons-react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

export interface AssistantMarkdownProps {
  content: string;
}

const getCodeText = (node: ReactNode): string => {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getCodeText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return getCodeText(node.props.children);
  return '';
};

const CodeBlock = ({ children, ...props }: HTMLAttributes<HTMLPreElement>) => {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(getCodeText(children).replace(/\n$/, ''));
      setCopied(true);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be unavailable; leave the button in its default state.
    }
  };

  return (
    <div className="assistant-code-block">
      <pre {...props}>{children}</pre>
      <button
        type="button"
        className={`assistant-code-block__copy ${copied ? 'assistant-code-block__copy--copied' : ''}`}
        onClick={() => { void copyCode(); }}
        aria-label={copied ? 'Code copied' : 'Copy code'}
      >
        <span className="assistant-code-block__copy-icons">
          <IconCopy size={14} strokeWidth={1.75} className="assistant-code-block__copy-icon" />
          <IconCheck size={14} strokeWidth={2} className="assistant-code-block__copied-icon" />
        </span>
      </button>
    </div>
  );
};

export const AssistantMarkdown = ({ content }: AssistantMarkdownProps) => (
  <div className="assistant-markdown">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        a: (props) => {
          const { node, ...anchorProps } = props;
          void node;
          return <a {...anchorProps} target="_blank" rel="noopener noreferrer" />;
        },
        pre: ({ children, node, ...props }) => {
          void node;
          return <CodeBlock {...props}>{children}</CodeBlock>;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
);
