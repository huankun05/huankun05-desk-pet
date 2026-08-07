/**
 * Markdown 渲染组件
 *
 * 基于 react-markdown + remark-gfm + highlight.js，
 * 支持 GFM 表格/任务列表、代码块语法高亮。
 * 同时兼容 <think> 标签（内心独白以斜体括号呈现）。
 */

import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/github-dark.css';
import { parseThinkTags } from '../../utils/thinkTagParser';

const mdComponents: Components = {
  p: ({ children }) => (
    <p style={{ margin: '0.3em 0', lineHeight: 1.65, wordBreak: 'break-word' }}>{children}</p>
  ),
  h1: ({ children }) => (
    <h1 style={{ fontSize: '1.25em', margin: '0.5em 0 0.3em', fontWeight: 700 }}>{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 style={{ fontSize: '1.15em', margin: '0.5em 0 0.3em', fontWeight: 700 }}>{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 style={{ fontSize: '1.05em', margin: '0.45em 0 0.25em', fontWeight: 700 }}>{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 style={{ fontSize: '1em', margin: '0.4em 0 0.2em', fontWeight: 700 }}>{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 style={{ fontSize: '0.95em', margin: '0.35em 0 0.2em', fontWeight: 700 }}>{children}</h5>
  ),
  h6: ({ children }) => (
    <h6 style={{ fontSize: '0.9em', margin: '0.35em 0 0.2em', fontWeight: 700 }}>{children}</h6>
  ),
  ul: ({ children }) => <ul style={{ margin: '0.3em 0', paddingLeft: '1.5em' }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: '0.3em 0', paddingLeft: '1.5em' }}>{children}</ol>,
  li: ({ children }) => <li style={{ margin: '0.15em 0', lineHeight: 1.6 }}>{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{ color: 'var(--accent)', textDecoration: 'underline' }}
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote
      style={{
        margin: '0.4em 0',
        padding: '4px 10px',
        borderLeft: '3px solid var(--accent)',
        background: 'var(--bg-hover)',
        borderRadius: '0 6px 6px 0',
        color: 'var(--text-secondary)',
      }}
    >
      {children}
    </blockquote>
  ),
  pre: ({ children }) => (
    <pre
      style={{
        background: '#0d1117',
        color: '#e6edf3',
        borderRadius: '8px',
        padding: '10px 12px',
        overflow: 'auto',
        fontSize: '0.9em',
        lineHeight: 1.55,
        margin: '6px 0',
      }}
    >
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    const match = /language-(\w+)/.exec(className || '');
    if (!match) {
      // 行内代码
      return (
        <code
          style={{
            background: 'var(--bg-hover)',
            padding: '1px 5px',
            borderRadius: '4px',
            fontSize: '0.92em',
            fontFamily: '"Cascadia Code", Consolas, Menlo, monospace',
          }}
        >
          {children}
        </code>
      );
    }
    // 块级代码：尝试语法高亮
    const lang = match[1];
    const code = String(children).replace(/\n$/, '');
    try {
      if (hljs.getLanguage(lang)) {
        const html = hljs.highlight(code, { language: lang }).value;
        return (
          <code
            className="hljs"
            style={{ background: 'transparent', padding: 0, fontSize: '0.95em' }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      }
    } catch {
      /* 语言不支持时回退纯文本 */
    }
    return <code>{children}</code>;
  },
  table: ({ children }) => (
    <table
      style={{
        borderCollapse: 'collapse',
        margin: '6px 0',
        fontSize: '0.9em',
        width: '100%',
      }}
    >
      {children}
    </table>
  ),
  th: ({ children }) => (
    <th
      style={{
        border: '1px solid var(--border)',
        padding: '4px 8px',
        background: 'var(--bg-hover)',
        textAlign: 'left',
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td style={{ border: '1px solid var(--border)', padding: '4px 8px' }}>{children}</td>
  ),
  img: ({ src, alt }) => (
    <img src={src} alt={alt} style={{ maxWidth: '100%', borderRadius: '6px', margin: '4px 0' }} />
  ),
  hr: () => (
    <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '8px 0' }} />
  ),
};

function MarkdownRender({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
      {content}
    </ReactMarkdown>
  );
}

/** 兼容 think 标签的 Markdown 正文 */
function MarkdownBody({ content }: { content: string }) {
  const segments = parseThinkTags(content);
  // 纯文本（无 think 标签）时直接渲染，减少包裹层级
  if (segments.length === 1 && segments[0].type === 'text') {
    return <MarkdownRender content={segments[0].content} />;
  }
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'think' ? (
          <em
            key={i}
            style={{
              opacity: 0.6,
              fontStyle: 'italic',
              fontSize: '0.9em',
              display: 'block',
            }}
          >
            <MarkdownRender content={seg.content} />
          </em>
        ) : (
          <MarkdownRender key={i} content={seg.content} />
        ),
      )}
    </>
  );
}

export default memo(MarkdownBody);
