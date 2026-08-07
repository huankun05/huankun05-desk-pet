import { useState } from 'react';
import { Icon } from '@iconify/react';

interface ToolCallBlockProps {
  name: string;
  input: unknown;
  output: unknown;
  status: 'running' | 'success' | 'error';
}

// 工具调用展示块：可折叠，显示输入/输出 JSON
export function ToolCallBlock({ name, input, output, status }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const statusIcon = {
    running: 'solar:server-square-cloud-linear',
    success: 'solar:check-circle-linear',
    error: 'solar:close-circle-linear',
  }[status];
  const statusColor = {
    running: 'var(--text-secondary)',
    success: 'var(--color-success)',
    error: 'var(--color-danger)',
  }[status];

  return (
    <div
      style={{
        margin: '4px 0',
        border: '1px solid var(--glass-border)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-surface)',
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          padding: '6px 10px',
          border: 'none',
          background: 'transparent',
          color: 'var(--text-primary)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: '12px',
        }}
      >
        <Icon icon={statusIcon} width={14} height={14} color={statusColor} />
        <span style={{ fontWeight: 500 }}>{name}</span>
        <Icon
          icon={expanded ? 'solar:alt-arrow-up-linear' : 'solar:alt-arrow-down-linear'}
          width={12}
          height={12}
          style={{ marginLeft: 'auto' }}
        />
      </button>
      {expanded && (
        <div
          style={{
            padding: '8px 10px',
            fontSize: '11px',
            color: 'var(--text-secondary)',
            borderTop: '1px solid var(--glass-border)',
          }}
        >
          <div style={{ marginBottom: 4 }}>
            <strong>输入:</strong>
            <pre style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>
          {output !== undefined && (
            <div>
              <strong>输出:</strong>
              <pre style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(output, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
