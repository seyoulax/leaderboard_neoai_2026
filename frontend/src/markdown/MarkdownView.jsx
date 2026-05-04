import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';

export default function MarkdownView({ children }) {
  return (
    <div className="markdown">
      <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{children || ''}</ReactMarkdown>
    </div>
  );
}
