// 技能目录 —— 内置可用技能库的元数据。
//
// 定义系统内置的可用技能（未安装），用户可以根据需要安装。
// 每个技能包含 id、名称、描述、分类、版本等元数据。
// 安装时会将技能模板复制到用户技能目录。

import type { SkillMode } from "./types";

/** 技能目录项（可安装的技能元数据） */
export interface SkillCatalogItem {
  /** 技能唯一标识（kebab-case） */
  id: string;
  /** 技能名称（展示用） */
  name: string;
  /** 技能描述（用于推荐匹配） */
  description: string;
  /** 技能分类 */
  category: string;
  /** 技能版本 */
  version: string;
  /** 适用的会话模式 */
  modes?: SkillMode[];
  /** 关联的工具 id */
  tools?: string[];
  /** 技能标签（用于搜索和推荐） */
  tags: string[];
  /** 是否为内置技能（内置技能已预装，不可重复安装） */
  builtin?: boolean;
  /** 安装所需的依赖（npm 包等） */
  dependencies?: string[];
}

// ── 内置技能目录 ────────────────────────────────────────────

/**
 * 内置可用技能目录。
 * 包含常用的技能模板，用户可以根据需要安装。
 * 每个技能都有详细的描述和标签，用于推荐匹配。
 */
export const SKILL_CATALOG: SkillCatalogItem[] = [
  // ── 编程/开发类 ──────────────────────────────────────────
  {
    id: "code-reviewer",
    name: "代码审查员",
    description: "审查代码质量，检查潜在 bug、安全漏洞、性能问题和代码规范问题，提供改进建议",
    category: "development",
    version: "1.0.0",
    modes: ["code", "work"],
    tools: ["read_file", "execute_code"],
    tags: ["代码审查", "code review", "代码质量", "bug", "安全", "性能", "规范"],
  },
  {
    id: "git-assistant",
    name: "Git 助手",
    description: "帮助管理 Git 仓库，包括提交、分支、合并、变基、冲突解决、历史查看等操作",
    category: "development",
    version: "1.0.0",
    modes: ["code", "work"],
    tools: ["run_shell", "read_file"],
    tags: ["git", "版本控制", "提交", "分支", "合并", "冲突", "commit", "branch", "merge"],
  },
  {
    id: "test-generator",
    name: "测试生成器",
    description: "自动生成单元测试、集成测试和端到端测试，支持多种测试框架和语言",
    category: "development",
    version: "1.0.0",
    modes: ["code", "work"],
    tools: ["read_file", "execute_code", "write_file"],
    tags: ["测试", "test", "单元测试", "集成测试", "jest", "pytest", "覆盖率"],
  },
  {
    id: "api-designer",
    name: "API 设计器",
    description: "设计 RESTful API 和 GraphQL API，生成接口文档、请求示例和响应 schema",
    category: "development",
    version: "1.0.0",
    modes: ["code", "work"],
    tools: ["write_file", "read_file"],
    tags: ["api", "接口", "rest", "graphql", "设计", "文档", "swagger", "openapi"],
  },

  // ── 数据/分析类 ──────────────────────────────────────────
  {
    id: "data-analyzer",
    name: "数据分析器",
    description: "分析 CSV、Excel、JSON 等数据文件，生成统计摘要、图表和洞察报告",
    category: "data",
    version: "1.0.0",
    modes: ["work", "learn"],
    tools: ["execute_code", "read_file"],
    tags: ["数据分析", "data", "统计", "图表", "csv", "excel", "可视化", "洞察"],
  },
  {
    id: "sql-assistant",
    name: "SQL 助手",
    description: "帮助编写、优化和调试 SQL 查询，支持多种数据库（MySQL、PostgreSQL、SQLite 等）",
    category: "data",
    version: "1.0.0",
    modes: ["work", "code"],
    tools: ["execute_code", "run_shell"],
    tags: ["sql", "数据库", "查询", "优化", "mysql", "postgresql", "sqlite"],
  },

  // ── 写作/创作类 ──────────────────────────────────────────
  {
    id: "article-writer",
    name: "文章写作助手",
    description: "帮助撰写博客文章、技术文档、新闻稿等，提供大纲生成、内容扩展和风格调整",
    category: "writing",
    version: "1.0.0",
    modes: ["work", "learn"],
    tools: ["write_file", "read_file"],
    tags: ["写作", "文章", "博客", "文档", "创作", "大纲", "blog", "article"],
  },
  {
    id: "translator",
    name: "翻译助手",
    description: "专业翻译工具，支持中英互译和多语言翻译，保持术语一致性和上下文理解",
    category: "writing",
    version: "1.0.0",
    modes: ["work", "learn"],
    tools: ["read_file", "write_file"],
    tags: ["翻译", "translate", "英语", "中文", "多语言", "术语"],
  },
  {
    id: "resume-builder",
    name: "简历优化器",
    description: "优化简历内容，突出关键技能和成就，针对特定职位定制简历，提供面试建议",
    category: "writing",
    version: "1.0.0",
    modes: ["work"],
    tools: ["read_file", "write_file"],
    tags: ["简历", "resume", "求职", "面试", "career", "优化"],
  },

  // ── 学习/教育类 ──────────────────────────────────────────
  {
    id: "tutor",
    name: "私教老师",
    description: "个性化学习辅导，根据学生水平定制学习计划，解答疑问，提供练习和反馈",
    category: "education",
    version: "1.0.0",
    modes: ["learn"],
    tools: ["execute_code"],
    tags: ["学习", "教学", "辅导", "tutor", "教育", "练习", "答疑"],
  },
  {
    id: "language-practice",
    name: "语言练习伙伴",
    description: "语言学习练习伙伴，支持对话练习、语法纠正、词汇扩展和发音指导",
    category: "education",
    version: "1.0.0",
    modes: ["learn"],
    tags: ["语言", "英语", "口语", "语法", "词汇", "language", "practice"],
  },

  // ── 生活/工具类 ──────────────────────────────────────────
  {
    id: "travel-planner",
    name: "旅行规划师",
    description: "规划旅行行程，包括交通、住宿、景点、美食推荐，生成详细的旅行计划和预算",
    category: "lifestyle",
    version: "1.0.0",
    modes: ["work"],
    tools: ["write_file"],
    tags: ["旅行", "旅游", "规划", "travel", "行程", "攻略", "预算"],
  },
  {
    id: "cooking-assistant",
    name: "烹饪助手",
    description: "根据食材和口味推荐菜谱，提供详细的烹饪步骤、营养信息和食材替换建议",
    category: "lifestyle",
    version: "1.0.0",
    modes: ["work"],
    tags: ["烹饪", "菜谱", "美食", "cooking", "食谱", "食材", "营养"],
  },
  {
    id: "fitness-coach",
    name: "健身教练",
    description: "个性化健身指导，根据目标和身体状况定制训练计划，提供动作指导和营养建议",
    category: "lifestyle",
    version: "1.0.0",
    modes: ["learn"],
    tags: ["健身", "运动", "训练", "fitness", "减肥", "增肌", "健康"],
  },

  // ── 办公/效率类 ──────────────────────────────────────────
  {
    id: "meeting-assistant",
    name: "会议助手",
    description: "会议记录和整理，生成会议纪要、待办事项和行动项，支持多语言会议内容总结",
    category: "productivity",
    version: "1.0.0",
    modes: ["work"],
    tools: ["write_file", "read_file"],
    tags: ["会议", "纪要", "总结", "meeting", "待办", "行动项"],
  },
  {
    id: "email-writer",
    name: "邮件写作助手",
    description: "帮助撰写专业邮件，根据场景和收件人调整语气，提供邮件模板和回复建议",
    category: "productivity",
    version: "1.0.0",
    modes: ["work"],
    tags: ["邮件", "email", "写作", "商务", "模板", "回复"],
  },
  {
    id: "project-manager",
    name: "项目经理",
    description: "项目管理助手，帮助制定项目计划、跟踪进度、管理任务、识别风险和协调资源",
    category: "productivity",
    version: "1.0.0",
    modes: ["work"],
    tools: ["write_file", "read_file"],
    tags: ["项目", "管理", "project", "计划", "进度", "任务", "风险"],
  },
];

// ── 工具函数 ────────────────────────────────────────────────

/**
 * 根据分类筛选技能目录。
 */
export function getSkillsByCategory(category: string): SkillCatalogItem[] {
  return SKILL_CATALOG.filter((s) => s.category === category);
}

/**
 * 获取所有分类列表。
 */
export function getSkillCategories(): string[] {
  return Array.from(new Set(SKILL_CATALOG.map((s) => s.category)));
}

/**
 * 根据 id 查找技能目录项。
 */
export function findSkillInCatalog(id: string): SkillCatalogItem | undefined {
  return SKILL_CATALOG.find((s) => s.id === id);
}

/**
 * 搜索技能目录（按名称、描述、标签模糊匹配）。
 */
export function searchSkillCatalog(query: string): SkillCatalogItem[] {
  const lowerQuery = query.toLowerCase();
  return SKILL_CATALOG.filter(
    (s) =>
      s.name.toLowerCase().includes(lowerQuery) ||
      s.description.toLowerCase().includes(lowerQuery) ||
      s.tags.some((t) => t.toLowerCase().includes(lowerQuery)),
  );
}
