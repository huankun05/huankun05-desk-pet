/**
 * ConsentGate — 权限确认卡
 *
 * 订阅事件总线 'permission:request'，以模态卡形式展示"助手想执行 X"，
 * 提供四级授权按钮（允许一次 / 始终允许 / 每次询问 / 拒绝）。高危或危险命令
 * 以红色醒目警示 + 参数原文展示，并强制"已知晓风险"勾选后才可放行。
 *
 * 与 PermissionManager 解耦：仅通过事件总线通信，不依赖 React 上下文。
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { eventBus } from '../services/eventBus';
import { permissionManager } from '../services/permission/PermissionManager';
import type { ConsentDecision, ConsentRequest } from '../services/permission/types';
import { RISK_COLOR, RISK_LABEL } from '../services/permission/capabilities';

const DECISIONS: Array<{
  key: ConsentDecision;
  label: string;
  primary?: boolean;
  danger?: boolean;
}> = [
  { key: 'once', label: '允许一次' },
  { key: 'always', label: '始终允许', primary: true },
  { key: 'ask', label: '每次询问' },
  { key: 'deny', label: '拒绝', danger: true },
];

export function ConsentGate() {
  const [queue, setQueue] = useState<ConsentRequest[]>([]);
  const [ackDanger, setAckDanger] = useState(false);

  useEffect(() => {
    permissionManager.markUIRegistered();
    const off = eventBus.on('permission:request', (req: ConsentRequest) => {
      setAckDanger(false);
      setQueue((q) => [...q, req]);
    });
    return off;
  }, []);

  const current = queue[0] ?? null;

  const resolve = (decision: ConsentDecision) => {
    if (!current) return;
    eventBus.emit('permission:resolve', { requestId: current.requestId, decision });
    setQueue((q) => q.slice(1));
    setAckDanger(false);
  };

  if (!current) return null;

  const isDanger = !!current.danger || current.risk === 'high';
  const allowDisabled = isDanger && !ackDanger;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(2px)',
      }}
      onClick={() => resolve('ask')}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 380,
          maxWidth: '90vw',
          borderRadius: 16,
          background: '#fff',
          boxShadow: isDanger
            ? '0 0 0 2px #dc2626, 0 20px 50px rgba(0,0,0,0.35)'
            : '0 20px 50px rgba(0,0,0,0.25)',
          padding: 20,
          color: '#1f2937',
          fontSize: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 6,
              color: '#fff',
              background: RISK_COLOR[current.risk],
            }}
          >
            {RISK_LABEL[current.risk]}风险
          </span>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{current.title}</span>
        </div>

        <p style={{ margin: '0 0 10px', color: '#4b5563', lineHeight: 1.6 }}>
          {current.description}
        </p>

        {current.paramsSummary && (
          <pre
            style={{
              margin: '0 0 12px',
              padding: 10,
              borderRadius: 8,
              background: isDanger ? '#fef2f2' : '#f3f4f6',
              border: isDanger ? '1px solid #fecaca' : '1px solid #e5e7eb',
              color: isDanger ? '#b91c1c' : '#374151',
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 120,
              overflowY: 'auto',
            }}
          >
            {current.paramsSummary}
          </pre>
        )}

        {isDanger && (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 12,
              fontSize: 13,
              color: '#b91c1c',
              fontWeight: 600,
            }}
          >
            <input
              type="checkbox"
              checked={ackDanger}
              onChange={(e) => setAckDanger(e.target.checked)}
            />
            我已知晓此操作存在风险
          </label>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {DECISIONS.map((d) => (
            <button
              key={d.key}
              type="button"
              disabled={d.primary && allowDisabled}
              onClick={() => resolve(d.key)}
              style={{
                flex: 1,
                minWidth: 84,
                padding: '9px 0',
                borderRadius: 10,
                border: '1px solid #d1d5db',
                cursor: allowDisabled && d.primary ? 'not-allowed' : 'pointer',
                fontSize: 13,
                fontWeight: 600,
                background: d.danger ? '#dc2626' : d.primary ? '#4f46e5' : '#fff',
                color: d.danger || d.primary ? '#fff' : '#374151',
                opacity: d.primary && allowDisabled ? 0.5 : 1,
              }}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default ConsentGate;
