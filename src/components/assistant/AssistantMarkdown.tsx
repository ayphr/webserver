import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface AssistantMarkdownProps {
  content: string;
}

export const AssistantMarkdown = ({ content }: AssistantMarkdownProps) => (
  <div className="assistant-markdown">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
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
