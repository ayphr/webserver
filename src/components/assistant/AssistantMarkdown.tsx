import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

export interface AssistantMarkdownProps {
  content: string;
}

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
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
);
