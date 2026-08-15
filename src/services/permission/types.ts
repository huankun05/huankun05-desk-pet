/**
 * 权限系统类型定义
 *
 * 能力（Capability）分级 + 授权状态模型，对标终端 AI 工具（Claude Code / Codex）的
 * 四级授权：始终允许 / 每次询问 / 拒绝（持久态）+ 仅一次（运行时一次性）。
 */

/** 风险等级 */
export type RiskLevel = 'low' | 'medium' | 'high';

/** 持久化授权模式 */
export type AuthMode = 'always' | 'ask' | 'deny';

/** 运行时一次性决策（不持久化） */
export type ConsentDecision = 'once' | 'always' | 'session' | 'deny' | 'ask';

/** 审计日志保留周期 */
export type RetentionPeriod = 'week' | 'month' | 'quarter' | 'forever';

/** 能力分组：系统能力（OS 授权） vs 操作能力（动作） */
export type CapabilityGroup = 'system' | 'action';

/** 能力定义 */
export interface CapabilityDef {
  /** 能力唯一 id（操作能力通常与工具名一致） */
  id: string;
  /** 对应的 ToolRegistry 工具名（若存在） */
  toolName?: string;
  /** 风险等级 */
  risk: RiskLevel;
  /** 默认授权模式（按风险给出推荐默认） */
  defaultMode: AuthMode;
  /** 人类可读名称（中文） */
  label: string;
  /** 白话说明 */
  description: string;
  /** 分组 */
  group: CapabilityGroup;
}

/** 确认请求（由 PermissionManager 发给 UI） */
export interface ConsentRequest {
  requestId: string;
  capabilityId: string;
  toolName: string;
  risk: RiskLevel;
  /** 标题，如「打开网易云音乐」 */
  title: string;
  /** 白话描述 */
  description: string;
  /** 参数摘要（如要执行的命令原文） */
  paramsSummary?: string;
  /** 是否为高危/危险命令（需红色警示 + 二次确认） */
  danger?: boolean;
  /** 触发来源：voice / chat */
  source?: string;
}

/** 授权判定结果 */
export interface AuthResult {
  allowed: boolean;
  reason?: string;
  decision?: ConsentDecision;
}

/** 审计日志条目 */
export interface AuditEntry {
  ts: number;
  capabilityId: string;
  toolName: string;
  title: string;
  /** 动作描述，如「执行命令: dir C:\」 */
  action: string;
  decision: ConsentDecision | 'always' | 'deny' | 'session' | 'ask' | 'timeout';
  allowed: boolean;
  source?: string;
  risk: RiskLevel;
}

/** 危险命令黑名单匹配结果 */
export interface DangerCheck {
  dangerous: boolean;
  /** 命中的危险模式（用于提示） */
  matched?: string;
}
