/**
 * PermissionManager — 权限网关单例
 *
 * 职责：
 * 1. 维护每个能力的授权模式（始终允许 / 每次询问 / 拒绝）与"本次会话全部允许"开关；
 * 2. 在工具执行前（toolRegistry.execute）把关：低危默认放行，中高危按策略/确认卡决策；
 * 3. 高危或命中危险命令黑名单时强制二次确认（红色警示）；
 * 4. 全量审计日志（本地 localStorage，绝不联网）。
 *
 * 与 UI 解耦：通过事件总线 'permission:request' / 'permission:resolve' 与 ConsentGate 通信，
 * 工具循环（异步上下文）无需直接碰 DOM。
 */

import { eventBus } from '../eventBus';
import {
  ACTION_CAPABILITIES,
  DANGEROUS_COMMAND_PATTERNS,
  getCapabilityByTool,
  adHocCapability,
  isCommandWhitelisted,
} from './capabilities';
import type {
  AuthMode,
  AuthResult,
  AuditEntry,
  ConsentDecision,
  ConsentRequest,
  DangerCheck,
  RetentionPeriod,
  RiskLevel,
} from './types';

const K_ENABLED = 'deskpet_perm_enabled';
const K_POLICIES = 'deskpet_perm_policies';
const K_SESSION_TRUST = 'deskpet_perm_session_trust';
const K_AUDIT_ENABLED = 'deskpet_perm_audit_enabled';
const K_AUDIT = 'deskpet_perm_audit';
const K_RETENTION = 'deskpet_perm_retention';
const K_WHITELIST = 'deskpet_perm_cmd_whitelist';

const CONSENT_TIMEOUT_MS = 120_000;

const RETENTION_DAYS: Record<RetentionPeriod, number> = {
  week: 7,
  month: 30,
  quarter: 90,
  forever: Infinity,
};

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore quota / private mode */
  }
}
function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function buildParamsSummary(toolName: string, args: Record<string, unknown>): string | undefined {
  if (toolName === 'run_command' && typeof args.command === 'string') {
    return args.command;
  }
  if (toolName === 'open_app' && typeof args.app_name === 'string') {
    return `应用：${args.app_name}`;
  }
  if (toolName === 'open_url' && typeof args.url === 'string') {
    return `网址：${args.url}`;
  }
  if ((toolName === 'open_file' || toolName === 'open_folder') && typeof args.path === 'string') {
    return `路径：${args.path}`;
  }
  if (toolName === 'media_control' && typeof args.action === 'string') {
    const label: Record<string, string> = {
      play_pause: '播放/暂停',
      next: '下一首',
      prev: '上一首',
      stop: '停止',
      mute: '静音',
      volume_up: '音量+',
      volume_down: '音量-',
    };
    return `动作：${label[args.action] ?? args.action}`;
  }
  if (toolName === 'notify' && typeof args.title === 'string') {
    return `通知：${args.title}`;
  }
  if (toolName === 'set_volume' && typeof args.level !== 'undefined') {
    return `音量：${args.level}`;
  }
  if (toolName === 'write_clipboard' && typeof args.text === 'string') {
    return `文本（${args.text.length} 字符，未展示内容）`;
  }
  if (toolName === 'write_file' || toolName === 'save_to_desktop') {
    const parts: string[] = [];
    if (typeof args.path === 'string') parts.push(`路径：${args.path}`);
    if (typeof args.filename === 'string') parts.push(`文件：${args.filename}`);
    return parts.length ? parts.join('  ') : undefined;
  }
  // 兜底：仅展示关键字符串参数，避免泄露大段内容
  const keys = Object.keys(args).filter((k) => typeof args[k] === 'string');
  if (keys.length === 0) return undefined;
  return keys
    .slice(0, 3)
    .map((k) => `${k}=${String(args[k]).slice(0, 60)}`)
    .join('  ');
}

function buildTitle(capLabel: string, toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'open_app' && typeof args.app_name === 'string') {
    return `打开${args.app_name}`;
  }
  if (toolName === 'open_file') {
    return '打开文件';
  }
  if (toolName === 'open_folder') {
    return '打开文件夹';
  }
  if (toolName === 'media_control') {
    return '媒体控制';
  }
  if (toolName === 'notify') {
    return '系统通知';
  }
  if (toolName === 'lock_screen') {
    return '锁定屏幕';
  }
  if (toolName === 'set_volume') {
    return '设置音量';
  }
  if (toolName === 'write_clipboard') {
    return '写入剪贴板';
  }
  if (toolName === 'run_command') {
    return '执行命令';
  }
  return capLabel;
}

export class PermissionManager {
  private uiRegistered = false;

  // ===== 总开关 =====
  isEnabled(): boolean {
    return safeGet(K_ENABLED) !== 'false';
  }
  setEnabled(v: boolean): void {
    safeSet(K_ENABLED, v ? 'true' : 'false');
  }

  // ===== "本次会话全部允许" =====
  isSessionTrust(): boolean {
    return safeGet(K_SESSION_TRUST) === 'true';
  }
  setSessionTrust(v: boolean): void {
    safeSet(K_SESSION_TRUST, v ? 'true' : 'false');
  }
  /** 应用启动时调用：清空"本次会话全部允许"（仅限本次会话，重启即失效） */
  resetSessionTrustOnLaunch(): void {
    safeRemove(K_SESSION_TRUST);
  }

  // ===== 审计开关 =====
  isAuditEnabled(): boolean {
    return safeGet(K_AUDIT_ENABLED) !== 'false';
  }
  setAuditEnabled(v: boolean): void {
    safeSet(K_AUDIT_ENABLED, v ? 'true' : 'false');
  }

  // ===== 保留周期 =====
  getRetention(): RetentionPeriod {
    const v = safeGet(K_RETENTION) as RetentionPeriod | null;
    return v && v in RETENTION_DAYS ? v : 'month';
  }
  setRetention(v: RetentionPeriod): void {
    safeSet(K_RETENTION, v);
  }

  // ===== 授权策略（按能力） =====
  private loadPolicies(): Record<string, AuthMode> {
    const raw = safeGet(K_POLICIES);
    if (!raw) return {};
    try {
      const obj = JSON.parse(raw);
      return typeof obj === 'object' && obj ? obj : {};
    } catch {
      return {};
    }
  }
  private savePolicies(map: Record<string, AuthMode>): void {
    safeSet(K_POLICIES, JSON.stringify(map));
  }
  getPolicy(capabilityId: string): AuthMode {
    const map = this.loadPolicies();
    if (map[capabilityId]) return map[capabilityId];
    const cap =
      getCapabilityByTool(capabilityId) ?? ACTION_CAPABILITIES.find((c) => c.id === capabilityId);
    return cap ? cap.defaultMode : 'ask';
  }
  setPolicy(capabilityId: string, mode: AuthMode): void {
    const map = this.loadPolicies();
    map[capabilityId] = mode;
    this.savePolicies(map);
  }

  // ===== 命令白名单（危险命令可放行项） =====
  getWhitelist(): string[] {
    const raw = safeGet(K_WHITELIST);
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }
  setWhitelist(list: string[]): void {
    safeSet(K_WHITELIST, JSON.stringify(list));
  }

  // ===== 危险命令检测 =====
  checkDanger(toolName: string, args: Record<string, unknown>): DangerCheck {
    if (toolName !== 'run_command') return { dangerous: false };
    const command = typeof args.command === 'string' ? args.command : '';
    if (isCommandWhitelisted(command)) return { dangerous: false };
    const wl = this.getWhitelist();
    if (wl.some((w) => command.includes(w))) return { dangerous: false };
    for (const { pattern, label } of DANGEROUS_COMMAND_PATTERNS) {
      if (pattern.test(command)) return { dangerous: true, matched: label };
    }
    return { dangerous: false };
  }

  // ===== 核心：授权判定 =====
  async authorize(
    toolName: string,
    args: Record<string, unknown> = {},
    opts: { source?: string } = {},
  ): Promise<AuthResult> {
    // 总开关关闭 → 放行（兼容旧行为）
    if (!this.isEnabled()) {
      return { allowed: true, decision: 'always' };
    }

    const cap = getCapabilityByTool(toolName) ?? adHocCapability(toolName);
    const danger = this.checkDanger(toolName, args).dangerous || cap.risk === 'high';

    // "本次会话全部允许"：跳过所有询问（高危危险命令仍强制二次确认，安全底线）
    if (this.isSessionTrust() && !danger) {
      this.recordAudit({
        capabilityId: cap.id,
        toolName,
        title: buildTitle(cap.label, toolName, args),
        action: cap.label,
        decision: 'session',
        allowed: true,
        source: opts.source,
        risk: cap.risk,
      });
      return { allowed: true, decision: 'session' };
    }

    const policy = this.getPolicy(cap.id);

    if (policy === 'always') {
      this.recordAudit({
        capabilityId: cap.id,
        toolName,
        title: buildTitle(cap.label, toolName, args),
        action: cap.label,
        decision: 'always',
        allowed: true,
        source: opts.source,
        risk: cap.risk,
      });
      return { allowed: true, decision: 'always' };
    }

    if (policy === 'deny') {
      this.recordAudit({
        capabilityId: cap.id,
        toolName,
        title: buildTitle(cap.label, toolName, args),
        action: cap.label,
        decision: 'deny',
        allowed: false,
        source: opts.source,
        risk: cap.risk,
      });
      return { allowed: false, reason: '该能力已被设置为「拒绝」' };
    }

    // policy === 'ask'（或首次触发，无持久策略）→ 弹确认卡
    const requestId = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const req: ConsentRequest = {
      requestId,
      capabilityId: cap.id,
      toolName,
      risk: cap.risk,
      title: buildTitle(cap.label, toolName, args),
      description: cap.description,
      paramsSummary: buildParamsSummary(toolName, args),
      danger,
      source: opts.source,
    };

    const decision = await this.requestConsent(req);

    if (decision === 'always') {
      this.setPolicy(cap.id, 'always');
      this.recordAudit({ ...this.auditOf(req), decision: 'always', allowed: true });
      return { allowed: true, decision: 'always' };
    }
    if (decision === 'session') {
      this.recordAudit({ ...this.auditOf(req), decision: 'session', allowed: true });
      return { allowed: true, decision: 'session' };
    }
    if (decision === 'once') {
      this.recordAudit({ ...this.auditOf(req), decision: 'once', allowed: true });
      return { allowed: true, decision: 'once' };
    }
    if (decision === 'deny') {
      this.setPolicy(cap.id, 'deny');
      this.recordAudit({ ...this.auditOf(req), decision: 'deny', allowed: false });
      return { allowed: false, reason: '用户拒绝授权' };
    }
    // 'ask'：保持每次询问，本次拒绝
    this.recordAudit({ ...this.auditOf(req), decision: 'ask', allowed: false });
    return { allowed: false, reason: '已选择「每次询问」' };
  }

  private auditOf(req: ConsentRequest) {
    return {
      capabilityId: req.capabilityId,
      toolName: req.toolName,
      title: req.title,
      action: req.title,
      source: req.source,
      risk: req.risk,
    };
  }

  /** 向 UI 请求用户决策；UI 未挂载或无响应时安全降级为拒绝 */
  private requestConsent(req: ConsentRequest): Promise<ConsentDecision> {
    return new Promise<ConsentDecision>((resolve) => {
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        off();
      };
      const off = eventBus.on(
        'permission:resolve',
        (p: { requestId: string; decision: ConsentDecision }) => {
          if (p.requestId === req.requestId) {
            cleanup();
            resolve(p.decision);
          }
        },
      );
      const timer = setTimeout(() => {
        cleanup();
        resolve('deny');
      }, CONSENT_TIMEOUT_MS);

      eventBus.emit('permission:request', req);
    });
  }

  /** 由 ConsentGate 在挂载时调用，标记 UI 可用 */
  markUIRegistered(): void {
    this.uiRegistered = true;
  }
  isUIRegistered(): boolean {
    return this.uiRegistered;
  }

  // ===== 审计日志 =====
  private recordAudit(entry: Omit<AuditEntry, 'ts'>): void {
    if (!this.isAuditEnabled()) return;
    const full: AuditEntry = { ...entry, ts: Date.now() };
    try {
      const raw = safeGet(K_AUDIT);
      const arr: AuditEntry[] = raw ? JSON.parse(raw) : [];
      arr.push(full);
      // 上限 2000 条，超出丢弃最旧
      const trimmed = arr.length > 2000 ? arr.slice(arr.length - 2000) : arr;
      safeSet(K_AUDIT, JSON.stringify(trimmed));
    } catch {
      /* ignore */
    }
  }

  /** 读取审计日志（按保留周期过滤，最新在前） */
  getAudit(): AuditEntry[] {
    const raw = safeGet(K_AUDIT);
    if (!raw) return [];
    let arr: AuditEntry[];
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
    const days = RETENTION_DAYS[this.getRetention()];
    if (days !== Infinity) {
      const cutoff = Date.now() - days * 86_400_000;
      arr = arr.filter((e) => e.ts >= cutoff);
    }
    return arr.slice().sort((a, b) => b.ts - a.ts);
  }

  clearAudit(): void {
    safeRemove(K_AUDIT);
  }

  /** 各能力使用统计：{ count, lastUsed } */
  getUsageStats(): Record<string, { count: number; lastUsed: number }> {
    const stats: Record<string, { count: number; lastUsed: number }> = {};
    for (const e of this.getAudit()) {
      const s = stats[e.capabilityId] ?? { count: 0, lastUsed: 0 };
      s.count += 1;
      s.lastUsed = Math.max(s.lastUsed, e.ts);
      stats[e.capabilityId] = s;
    }
    return stats;
  }

  // ===== 恢复默认 =====
  resetAll(): void {
    safeRemove(K_POLICIES);
    safeRemove(K_SESSION_TRUST);
    safeRemove(K_WHITELIST);
    this.setEnabled(true);
    this.setAuditEnabled(true);
    this.setRetention('month');
  }
}

/** 全局单例 */
export const permissionManager = new PermissionManager();
