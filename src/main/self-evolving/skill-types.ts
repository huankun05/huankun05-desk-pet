// skill-types —— 自进化技能系统的类型定义。
// 技能是 Agent 的程序性记忆：捕获"如何完成特定类型任务"的可复用流程。
// 参考 Hermes Agent 的技能系统设计，移植到 Cyrene。

/** 技能来源：决定自整理/归档等自动操作的保护级别。 */
export type SkillSource =
  | "self-grown"   // Agent 自己沉淀的（默认，完全自由操作）
  | "external"     // 外部引入的（预装/市场/GitHub下载，Curator 不自动归档）
  | "forked"       // 从外部技能 fork 出的本地定制版（完全自由操作）
  | "umbrella";    // 自整理合并生成的伞技能（完全自由操作）

/** 技能元数据（从 SKILL.md 的 YAML frontmatter 解析）。 */
export interface SkillMetadata {
  /** 技能名称（唯一标识，小写字母数字连字符）。 */
  name: string;
  /** 技能描述（一句话说明用途，用于 Agent 判断何时调用）。 */
  description: string;
  /** 技能来源。默认 "self-grown"。外部引入的技能标记为 "external"，Curator 不自动归档。 */
  source?: SkillSource;
  /** 外部来源 URL（GitHub/市场链接，source=external 时填写）。 */
  sourceUrl?: string;
  /** 可选分类标签。 */
  category?: string;
  /** 技能版本。 */
  version?: string;
  /** 技能标签。 */
  tags?: string[];
  /** 创建者："user"（用户创建）或 "agent"（Agent 自进化创建）。 */
  createdBy?: "user" | "agent";
  /** 创建时间（ISO 字符串）。 */
  createdAt?: string;
  /** 最后修改时间（ISO 字符串）。 */
  updatedAt?: string;
  /** 被合并进的伞技能名称（自整理合并后，原技能标记此字段并归档）。 */
  mergedInto?: string;
  /** 是否为系统内置受保护技能（true 时禁止删除，Curator 不自动归档）。Cyrene 原有的内置技能自动标记为 true。 */
  protected?: boolean;
}

/** 技能完整内容（元数据 + Markdown body）。 */
export interface Skill extends SkillMetadata {
  /** SKILL.md 的完整 Markdown 内容（含 frontmatter）。 */
  content: string;
  /** 技能目录路径。 */
  dirPath: string;
  /** SKILL.md 文件路径。 */
  filePath: string;
}

/** 技能使用记录（用于跟踪和 Curator 后台维护）。 */
export interface SkillUsageRecord {
  /** 技能名称。 */
  name: string;
  /** 查看次数。 */
  viewCount: number;
  /** 使用次数（被 Agent 调用并成功执行的次数）。 */
  useCount: number;
  /** 成功使用次数（Agent 反馈使用成功）。 */
  successCount?: number;
  /** 失败使用次数（Agent 反馈使用失败）。 */
  failureCount?: number;
  /** 最后成功使用时间（ISO 字符串）。 */
  lastSuccessAt?: string;
  /** 最后失败使用时间（ISO 字符串）。 */
  lastFailureAt?: string;
  /** 修改次数（被 skill_manage patch/edit 的次数）。 */
  patchCount: number;
  /** 最后查看时间（ISO 字符串）。 */
  lastViewedAt?: string;
  /** 最后使用时间（ISO 字符串）。 */
  lastUsedAt?: string;
  /** 最后修改时间（ISO 字符串）。 */
  lastPatchedAt?: string;
  /** 是否被 pin（保护不被 Curator 自动归档）。 */
  pinned?: boolean;
  /** 技能状态：active / stale / archived。 */
  status?: "active" | "stale" | "archived";
  /** 被合并进的伞技能名称（自整理合并后，原技能标记此字段并归档）。 */
  mergedInto?: string;
  /** 创建者。 */
  createdBy?: "user" | "agent";
}

/** 技能列表项（用于 skill_list 工具返回，不含完整内容）。 */
export interface SkillListItem {
  name: string;
  description: string;
  category?: string;
  /** 技能来源：self-grown / external / forked / umbrella。 */
  source?: SkillSource;
  createdBy?: "user" | "agent";
  updatedAt?: string;
}

/** skill_manage 工具支持的操作。 */
export type SkillManageAction = "create" | "edit" | "patch" | "delete";

/** 技能验证错误。 */
export interface SkillValidationError {
  field: string;
  message: string;
}
