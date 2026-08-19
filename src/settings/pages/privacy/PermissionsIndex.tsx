import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Section, SettingRow, Switch, useToast } from '../../components';
import { permissionManager } from '../../../services/permission/PermissionManager';
import {
  ACTION_CAPABILITIES,
  SYSTEM_CAPABILITIES,
  RISK_COLOR,
  RISK_LABEL,
} from '../../../services/permission/capabilities';
import type {
  AuthMode,
  AuditEntry,
  RetentionPeriod,
  RiskLevel,
} from '../../../services/permission/types';

const AUTH_OPTIONS: Array<{ value: AuthMode; i18nKey: string }> = [
  { value: 'always', i18nKey: 'settings.privacy.auth_always' },
  { value: 'ask', i18nKey: 'settings.privacy.auth_ask' },
  { value: 'deny', i18nKey: 'settings.privacy.auth_deny' },
];

const RETENTION_OPTIONS: Array<{ value: RetentionPeriod; i18nKey: string }> = [
  { value: 'week', i18nKey: 'settings.privacy.ret_week' },
  { value: 'month', i18nKey: 'settings.privacy.ret_month' },
  { value: 'quarter', i18nKey: 'settings.privacy.ret_quarter' },
  { value: 'forever', i18nKey: 'settings.privacy.ret_forever' },
];

const RISK_ORDER: RiskLevel[] = ['low', 'medium', 'high'];

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return String(ts);
  }
}

/** 小型分段选择器（始终允许 / 每次询问 / 拒绝） */
function SegmentedControl({
  options,
  value,
  onChange,
  danger,
}: {
  options: Array<{ value: AuthMode; label: string }>;
  value: AuthMode;
  onChange: (v: AuthMode) => void;
  danger?: boolean;
}) {
  return (
    <div className="inline-flex rounded-lg border border-neutral-200 bg-neutral-50 p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
            style={{
              background: active ? (danger ? '#dc2626' : '#4f46e5') : 'transparent',
              color: active ? '#fff' : '#6b7280',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function PermissionsIndex() {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const authOptions = useMemo(
    () => AUTH_OPTIONS.map((o) => ({ value: o.value, label: t(o.i18nKey) })),
    [t],
  );
  const retentionOptions = useMemo(
    () => RETENTION_OPTIONS.map((o) => ({ value: o.value, label: t(o.i18nKey) })),
    [t],
  );

  const [enabled, setEnabled] = useState(true);
  const [sessionTrust, setSessionTrust] = useState(false);
  const [auditEnabled, setAuditEnabled] = useState(true);
  const [retention, setRetention] = useState<RetentionPeriod>('month');
  const [policies, setPolicies] = useState<Record<string, AuthMode>>({});
  const [usage, setUsage] = useState<Record<string, { count: number; lastUsed: number }>>({});
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  const [expanded, setExpanded] = useState<Record<RiskLevel, boolean>>({
    low: false,
    medium: false,
    high: false,
  });
  const [riskFilter, setRiskFilter] = useState<'all' | RiskLevel>('all');
  const [search, setSearch] = useState('');

  const reload = useCallback(() => {
    setEnabled(permissionManager.isEnabled());
    setSessionTrust(permissionManager.isSessionTrust());
    setAuditEnabled(permissionManager.isAuditEnabled());
    setRetention(permissionManager.getRetention());
    const ps: Record<string, AuthMode> = {};
    for (const c of ACTION_CAPABILITIES) ps[c.id] = permissionManager.getPolicy(c.id);
    setPolicies(ps);
    setUsage(permissionManager.getUsageStats());
    setAudit(permissionManager.getAudit());
  }, []);

  useEffect(() => {
    void (async () => {
      await reload();
    })();
  }, [reload]);

  const updatePolicy = (capId: string, mode: AuthMode) => {
    permissionManager.setPolicy(capId, mode);
    setPolicies((p) => ({ ...p, [capId]: mode }));
    showToast(t('settings.privacy.policy_toast', { defaultValue: '已更新授权方式' }), 'success');
  };

  const onToggleEnabled = (v: boolean) => {
    permissionManager.setEnabled(v);
    setEnabled(v);
  };
  const onToggleSessionTrust = (v: boolean) => {
    permissionManager.setSessionTrust(v);
    setSessionTrust(v);
  };
  const onToggleAudit = (v: boolean) => {
    permissionManager.setAuditEnabled(v);
    setAuditEnabled(v);
  };
  const onChangeRetention = (v: RetentionPeriod) => {
    permissionManager.setRetention(v);
    setRetention(v);
    setAudit(permissionManager.getAudit());
  };

  const onReset = () => {
    if (
      !window.confirm(
        t('settings.privacy.reset_confirm', {
          defaultValue: '确定恢复所有权限到默认设置吗？此操作不可撤销。',
        }),
      )
    )
      return;
    permissionManager.resetAll();
    reload();
    showToast(t('settings.privacy.reset_done', { defaultValue: '已恢复默认' }), 'success');
  };

  const onClearAudit = () => {
    if (
      !window.confirm(
        t('settings.privacy.clear_audit_confirm', { defaultValue: '确定清空全部权限使用记录吗？' }),
      )
    )
      return;
    permissionManager.clearAudit();
    setAudit([]);
    setUsage({});
    showToast(t('settings.privacy.cleared', { defaultValue: '已清空记录' }), 'success');
  };

  const onExportCsv = () => {
    if (audit.length === 0) {
      showToast(t('settings.privacy.no_record', { defaultValue: '暂无记录可导出' }), 'info');
      return;
    }
    const esc = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const header = ['时间', '能力', '工具', '动作', '风险', '决策', '允许', '来源'];
    const rows = audit.map((e) =>
      [
        fmtTime(e.ts),
        e.capabilityId,
        e.toolName,
        e.action,
        RISK_LABEL[e.risk],
        e.decision,
        e.allowed ? '是' : '否',
        e.source ?? '',
      ]
        .map(esc)
        .join(','),
    );
    const csv = '﻿' + [header.map(esc).join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `permission_audit_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(t('settings.privacy.exported', { defaultValue: '已导出 CSV' }), 'success');
  };

  const filteredAudit = useMemo(() => {
    const q = search.trim().toLowerCase();
    return audit.filter((e) => {
      if (riskFilter !== 'all' && e.risk !== riskFilter) return false;
      if (q && !(e.capabilityId.toLowerCase().includes(q) || e.action.toLowerCase().includes(q)))
        return false;
      return true;
    });
  }, [audit, riskFilter, search]);

  const grouped: Record<RiskLevel, typeof ACTION_CAPABILITIES> = {
    low: ACTION_CAPABILITIES.filter((c) => c.risk === 'low'),
    medium: ACTION_CAPABILITIES.filter((c) => c.risk === 'medium'),
    high: ACTION_CAPABILITIES.filter((c) => c.risk === 'high'),
  };

  return (
    <div className="p-5 animate-[fade-in-up_0.3s_ease-out]">
      {/* 总开关 */}
      <Section
        title={t('settings.privacy.general_title', { defaultValue: '总开关' })}
        description={t('settings.privacy.general_desc', {
          defaultValue: '控制语音操作是否需要授权，以及本次会话的免确认模式。',
        })}
      >
        <SettingRow
          title={t('settings.privacy.enable_title', { defaultValue: '启用权限管理' })}
          description={t('settings.privacy.enable_desc', {
            defaultValue: '关闭后所有工具将不经授权直接执行（兼容旧行为，不推荐）。',
          })}
        >
          <Switch checked={enabled} onChange={() => onToggleEnabled(!enabled)} />
        </SettingRow>
        <SettingRow
          title={t('settings.privacy.session_trust_title', { defaultValue: '🔓 本次会话全部允许' })}
          description={t('settings.privacy.session_trust_desc', {
            defaultValue: '开启后本次会话内跳过所有确认弹窗；重启应用自动失效，不持久化。',
          })}
        >
          <Switch checked={sessionTrust} onChange={() => onToggleSessionTrust(!sessionTrust)} />
        </SettingRow>
        <SettingRow
          title={t('settings.privacy.audit_title', { defaultValue: '记录使用日志' })}
          description={t('settings.privacy.audit_desc', {
            defaultValue: '记录每一次权限使用（麦克风、执行命令、打开应用等），仅存本地。',
          })}
        >
          <Switch checked={auditEnabled} onChange={() => onToggleAudit(!auditEnabled)} />
        </SettingRow>
      </Section>

      {/* 按风险分级折叠 */}
      <Section
        title={t('settings.privacy.cap_title', { defaultValue: '能力授权' })}
        description={t('settings.privacy.cap_desc', {
          defaultValue: '按风险等级分组，默认折叠。点击展开可逐项设置授权方式。',
        })}
      >
        {RISK_ORDER.map((risk) => {
          const caps = grouped[risk];
          const open = expanded[risk];
          return (
            <div
              key={risk}
              style={{
                border: `1px solid ${risk === 'high' ? '#fecaca' : '#e5e7eb'}`,
                borderRadius: 12,
                marginBottom: 10,
                overflow: 'hidden',
                background: risk === 'high' ? '#fef2f2' : '#fff',
              }}
            >
              <button
                type="button"
                onClick={() => setExpanded((e) => ({ ...e, [risk]: !e[risk] }))}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 6,
                      color: '#fff',
                      background: RISK_COLOR[risk],
                    }}
                  >
                    {RISK_LABEL[risk]}
                  </span>
                  <span style={{ fontWeight: 600, color: '#374151', fontSize: 14 }}>
                    {t('settings.privacy.risk_group', { label: RISK_LABEL[risk] })}
                  </span>
                  <span style={{ color: '#9ca3af', fontSize: 12 }}>({caps.length})</span>
                </span>
                <span style={{ color: '#9ca3af', fontSize: 14 }}>{open ? '▾' : '▸'}</span>
              </button>
              {open && (
                <div style={{ padding: '4px 16px 14px' }}>
                  {caps.map((c) => {
                    const u = usage[c.id];
                    return (
                      <div
                        key={c.id}
                        style={{
                          padding: '10px 0',
                          borderTop: '1px solid #f1f1f4',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, color: '#1f2937', fontSize: 13 }}>
                              {c.label}
                              {c.risk === 'high' && (
                                <span
                                  style={{
                                    marginLeft: 6,
                                    color: '#dc2626',
                                    fontSize: 11,
                                    fontWeight: 700,
                                  }}
                                >
                                  ⚠ 高风险
                                </span>
                              )}
                            </div>
                            <div
                              style={{
                                color: '#6b7280',
                                fontSize: 12,
                                marginTop: 2,
                                lineHeight: 1.5,
                              }}
                            >
                              {c.description}
                            </div>
                            <div style={{ color: '#9ca3af', fontSize: 11, marginTop: 3 }}>
                              {u
                                ? `${t('settings.privacy.last_used', { defaultValue: '最近使用' })} ${fmtTime(u.lastUsed)} · ${t('settings.privacy.used_count', { defaultValue: '使用 {{n}} 次', n: u.count })}`
                                : t('settings.privacy.never_used', { defaultValue: '尚未使用' })}
                            </div>
                          </div>
                          <SegmentedControl
                            options={authOptions}
                            value={policies[c.id] ?? 'ask'}
                            onChange={(v) => updatePolicy(c.id, v)}
                            danger={c.risk === 'high'}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </Section>

      {/* 系统能力（OS 授权状态） */}
      <Section
        title={t('settings.privacy.sys_title', { defaultValue: '系统能力' })}
        description={t('settings.privacy.sys_desc', {
          defaultValue: '应用运转所需的操作系统权限，需在本机系统设置中授予。',
        })}
      >
        {SYSTEM_CAPABILITIES.map((c) => (
          <SettingRow key={c.id} title={c.label} description={c.description}>
            <span
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 6,
                background: '#f3f4f6',
                color: '#6b7280',
              }}
            >
              {t('settings.privacy.os_controlled', { defaultValue: '由系统控制' })}
            </span>
          </SettingRow>
        ))}
      </Section>

      {/* 审计日志 */}
      <Section
        title={t('settings.privacy.audit_log_title', { defaultValue: '权限使用记录' })}
        description={t('settings.privacy.audit_log_desc', {
          defaultValue: '所有权限使用都会留痕，可筛选、导出或清空。',
        })}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            padding: '4px 16px 10px',
          }}
        >
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            {t('settings.privacy.retention', { defaultValue: '保留时长' })}：
          </span>
          <div className="inline-flex rounded-lg border border-neutral-200 bg-neutral-50 p-0.5">
            {retentionOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => onChangeRetention(o.value)}
                className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
                style={{
                  background: retention === o.value ? '#4f46e5' : 'transparent',
                  color: retention === o.value ? '#fff' : '#6b7280',
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('settings.privacy.search_placeholder', {
              defaultValue: '搜索能力 / 动作…',
            })}
            style={{
              flex: 1,
              minWidth: 140,
              padding: '5px 10px',
              borderRadius: 8,
              border: '1px solid #e5e7eb',
              fontSize: 12,
              outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={onExportCsv}
            className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            {t('settings.privacy.export', { defaultValue: '导出 CSV' })}
          </button>
          <button
            type="button"
            onClick={onClearAudit}
            className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            {t('settings.privacy.clear', { defaultValue: '清空' })}
          </button>
        </div>

        <div style={{ padding: '0 16px 12px', display: 'flex', gap: 6 }}>
          {(['all', 'low', 'medium', 'high'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRiskFilter(r)}
              className="rounded-md px-2.5 py-1 text-xs font-medium"
              style={{
                background: riskFilter === r ? '#374151' : '#f3f4f6',
                color: riskFilter === r ? '#fff' : '#6b7280',
              }}
            >
              {r === 'all'
                ? t('settings.privacy.filter_all', { defaultValue: '全部' })
                : RISK_LABEL[r]}
            </button>
          ))}
        </div>

        <div style={{ padding: '0 16px 16px', maxHeight: 320, overflowY: 'auto' }}>
          {filteredAudit.length === 0 ? (
            <div style={{ color: '#9ca3af', fontSize: 12, textAlign: 'center', padding: '20px' }}>
              {t('settings.privacy.empty', { defaultValue: '暂无记录' })}
            </div>
          ) : (
            filteredAudit.map((e, i) => (
              <div
                key={`${e.ts}-${i}`}
                style={{
                  padding: '8px 0',
                  borderTop: '1px solid #f1f1f4',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    flexShrink: 0,
                    background: e.allowed ? '#16a34a' : '#dc2626',
                  }}
                />
                <span style={{ color: '#6b7280', width: 130, flexShrink: 0 }}>{fmtTime(e.ts)}</span>
                <span
                  style={{
                    flex: 1,
                    color: '#374151',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {e.action}
                </span>
                <span style={{ color: '#9ca3af', fontSize: 11, flexShrink: 0 }}>
                  {RISK_LABEL[e.risk]} · {e.decision}
                </span>
              </div>
            ))
          )}
        </div>
      </Section>

      {/* 隐私声明 */}
      <Section
        title={t('settings.privacy.notice_title', { defaultValue: '隐私声明' })}
        description={t('settings.privacy.notice_desc', {
          defaultValue:
            '所有授权与记录均保存在本机，不会上传任何服务器。你可随时撤销授权或清空记录。',
        })}
      >
        <div className="px-4 py-3 text-xs leading-relaxed text-neutral-500">
          {t('settings.privacy.notice_body', {
            defaultValue:
              '权限管理仅在本机生效。危险命令（如 rm -rf、格式化、关机、修改注册表等）无论授权状态如何，都会强制要求你二次确认。',
          })}
        </div>
      </Section>

      {/* 重置 */}
      <Section title={t('settings.privacy.danger_title', { defaultValue: '恢复默认' })}>
        <SettingRow
          title={t('settings.privacy.reset_all_title', { defaultValue: '恢复全部权限到默认' })}
          description={t('settings.privacy.reset_all_desc', {
            defaultValue: '清除所有自定义授权、本次会话免确认与记录保留设置。',
          })}
        >
          <button
            type="button"
            onClick={onReset}
            className="rounded-lg border border-red-200 bg-white px-3.5 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            {t('settings.privacy.reset_btn', { defaultValue: '恢复默认' })}
          </button>
        </SettingRow>
      </Section>
    </div>
  );
}

export default PermissionsIndex;
