// Skill 推荐器 —— 根据用户输入推荐相关技能。
//
// 设计原则：
// - 纯函数，不依赖 registry/electron，易于测试
// - 基于关键词匹配（技能描述中的关键词与用户输入匹配）
// - 简单的评分机制（匹配的关键词越多、越重要，评分越高）
// - 支持按模式过滤（work/code/learn）

import type { SkillEntry, SkillMode } from "./types";

// ── 类型定义 ────────────────────────────────────────────────

/** 推荐结果 */
export interface SkillRecommendation {
  skill: SkillEntry;
  /** 匹配分数（0-100） */
  score: number;
  /** 匹配的关键词列表 */
  matchedKeywords: string[];
  /** 匹配原因（人类可读） */
  reason: string;
}

// ── 同义词词典 ──────────────────────────────────────────────

/**
 * 同义词词典：将用户输入的关键词扩展为同义词，提升推荐的准确性。
 * 每个数组是一组同义词，匹配其中任意一个都算匹配。
 * 包含中英文常见同义词。
 */
const SYNONYM_GROUPS: string[][] = [
  // 编程/代码
  ["写代码", "编程", "代码", "程序", "开发", "code", "coding", "programming", "develop", "script"],
  ["python", "py", "蟒蛇"],
  ["javascript", "js", "node", "nodejs"],
  ["typescript", "ts"],

  // 音乐/音频
  ["音乐", "听歌", "歌曲", "播放音乐", "music", "song", "audio", "play", "播放"],
  ["播放器", "player"],

  // 天气/环境
  ["天气", "气温", "weather", "temperature", "forecast", "预报"],

  // 翻译/语言
  ["翻译", "translate", "translation", "language", "语言"],
  ["英语", "英文", "english"],
  ["中文", "汉语", "chinese"],

  // 搜索/查询
  ["搜索", "查找", "查询", "search", "find", "query", "google", "百度"],
  ["网页", "网站", "web", "website", "browser", "浏览器"],

  // 文件/文档
  ["文件", "文档", "file", "document", "doc", "pdf", "excel", "表格", "word"],
  ["读取", "打开", "read", "open", "load"],
  ["写入", "保存", "write", "save", "store"],

  // 邮件/消息
  ["邮件", "email", "mail", "gmail"],
  ["消息", "聊天", "message", "chat", "im"],

  // 日历/时间
  ["日历", "日程", "calendar", "schedule", "event", "事件", "约会"],
  ["提醒", "闹钟", "reminder", "alarm", "notify", "通知"],
  ["时间", "日期", "time", "date"],

  // 系统/工具
  ["终端", "命令行", "shell", "terminal", "cmd", "powershell", "bash"],
  ["系统", "system", "os", "操作系统"],
  ["进程", "process", "task", "任务"],

  // 学习/教育
  ["学习", "教程", "learn", "study", "tutorial", "course", "课程"],
  ["笔记", "note", "notes", "markdown"],

  // 写作/创作
  ["写作", "写文章", "write", "writing", "article", "文章", "essay", "论文"],
  ["总结", "摘要", "summary", "summarize", "abstract"],
  ["翻译", "translate", "translation"],

  // 图像/视觉
  ["图片", "图像", "image", "picture", "photo", "照片"],
  ["画图", "绘图", "draw", "painting", "绘画"],

  // 视频/媒体
  ["视频", "video", "movie", "电影", "影片"],
  ["播放", "play", "player", "播放器"],

  // 数学/计算
  ["数学", "计算", "math", "calculate", "calculation", "compute"],
  ["公式", "formula", "equation", "方程"],

  // 数据/分析
  ["数据", "data", "分析", "analysis", "analyze", "statistics", "统计"],
  ["图表", "chart", "graph", "plot", "可视化", "visualization"],

  // 安全/隐私
  ["安全", "security", "safe", "privacy", "隐私"],
  ["密码", "password", "加密", "encrypt", "encryption"],

  // 网络/连接
  ["网络", "network", "internet", "互联网", "wifi", "蓝牙", "bluetooth"],
  ["下载", "download", "上传", "upload"],

  // 购物/电商
  ["购物", "shopping", "buy", "购买", "商品", "product", "价格", "price"],

  // 导航/地图
  ["导航", "navigation", "地图", "map", "路线", "route", "direction", "方向"],

  // 健康/医疗
  ["健康", "health", "医疗", "medical", "medicine", "药物", "doctor", "医生"],
  ["运动", "exercise", "fitness", "健身", "跑步", "run"],

  // 财务/理财
  ["财务", "finance", "理财", "money", "钱", "银行", "bank", "账单", "bill"],

  // 旅行/出行
  ["旅行", "旅游", "travel", "trip", "机票", "flight", "酒店", "hotel"],
];

/** 构建同义词映射：每个词 -> 其所在同义词组的所有词 */
function buildSynonymMap(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const group of SYNONYM_GROUPS) {
    const lowerGroup = group.map((w) => w.toLowerCase());
    for (const word of lowerGroup) {
      if (!map.has(word)) {
        map.set(word, lowerGroup);
      }
    }
  }
  return map;
}

const SYNONYM_MAP = buildSynonymMap();

/**
 * 扩展关键词：将每个关键词扩展为其同义词组的所有词。
 * 去重后返回。
 */
function expandKeywords(keywords: string[]): string[] {
  const expanded = new Set<string>();
  for (const kw of keywords) {
    expanded.add(kw);
    const synonyms = SYNONYM_MAP.get(kw.toLowerCase());
    if (synonyms) {
      for (const syn of synonyms) {
        expanded.add(syn);
      }
    }
  }
  return Array.from(expanded);
}

// ── 关键词提取 ──────────────────────────────────────────────

/**
 * 从文本中提取关键词（简单的分词 + 停用词过滤）。
 * 支持中英文混合。
 */
function extractKeywords(text: string): string[] {
  if (!text) return [];

  // 转小写
  const lower = text.toLowerCase();

  // 提取英文单词（2个字符以上）
  const englishWords = lower.match(/[a-z]{2,}/g) || [];

  // 提取中文词组（2-4个汉字连续）
  const chineseWords = lower.match(/[\u4e00-\u9fa5]{2,4}/g) || [];

  // 停用词列表（中英文常见停用词）
  const stopWords = new Set([
    // 英文
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "need", "dare",
    "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
    "into", "through", "during", "before", "after", "above", "below",
    "between", "out", "off", "over", "under", "again", "further",
    "then", "once", "here", "there", "when", "where", "why", "how",
    "all", "any", "both", "each", "few", "more", "most", "other",
    "some", "such", "no", "nor", "not", "only", "own", "same", "so",
    "than", "too", "very", "just", "because", "if", "or", "and", "but",
    "what", "which", "who", "whom", "this", "that", "these", "those",
    "i", "me", "my", "myself", "we", "our", "ours", "ourselves",
    "you", "your", "yours", "yourself", "yourselves",
    "he", "him", "his", "himself", "she", "her", "hers", "herself",
    "it", "its", "itself", "they", "them", "their", "theirs", "themselves",
    "want", "need", "help", "please", "like", "know", "think", "make",
    "get", "go", "come", "take", "see", "look", "use", "find", "give",
    "tell", "ask", "work", "try", "call", "keep", "let", "begin", "seem",
    "help", "play", "move", "live", "believe", "bring", "happen", "write",
    "provide", "sit", "stand", "lose", "pay", "meet", "include", "continue",
    "set", "learn", "change", "lead", "understand", "watch", "follow", "stop",
    "create", "speak", "read", "allow", "add", "spend", "grow", "open",
    "walk", "win", "offer", "remember", "love", "consider", "appear",
    "buy", "wait", "serve", "die", "send", "expect", "build", "stay",
    "fall", "cut", "reach", "kill", "remain", "suggest", "raise", "pass",
    "sell", "require", "report", "decide", "pull", "none",
    // 中文
    "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都",
    "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会",
    "着", "没有", "看", "好", "自己", "这", "他", "她", "它", "们",
    "那", "些", "什么", "怎么", "为什么", "哪", "哪里", "谁", "多少",
    "几", "这", "那", "可以", "能", "能够", "应该", "必须", "需要",
    "想", "要", "请", "帮", "帮忙", "帮助", "谢谢", "麻烦", "一下",
    "把", "被", "让", "使", "给", "向", "从", "到", "在", "于",
    "和", "与", "及", "或", "而", "但", "如果", "因为", "所以", "虽然",
    "但是", "然后", "接着", "最后", "首先", "其次", "再次", "最终",
    "这个", "那个", "这些", "那些", "这样", "那样", "这么", "那么",
    "如何", "怎样", "怎么样", "什么样", "哪样", "哪些", "哪个",
    "做", "干", "弄", "搞", "整", "处理", "进行", "开始", "结束",
    "完成", "实现", "达到", "满足", "符合", "适应", "适合", "适用",
  ]);

  // 过滤停用词，去重
  const keywords = new Set<string>();
  for (const word of [...englishWords, ...chineseWords]) {
    if (!stopWords.has(word) && word.length >= 2) {
      keywords.add(word);
    }
  }

  return Array.from(keywords);
}

// ── 评分算法 ────────────────────────────────────────────────

/**
 * 计算用户输入与技能的匹配分数。
 *
 * 评分维度：
 * 1. 描述关键词匹配（权重 40%）
 * 2. 技能 id 匹配（权重 20%）
 * 3. 技能名称匹配（权重 20%）
 * 4. 关联工具匹配（权重 20%）
 */
function calculateScore(
  userKeywords: string[],
  skill: SkillEntry,
): { score: number; matchedKeywords: string[] } {
  if (userKeywords.length === 0) {
    return { score: 0, matchedKeywords: [] };
  }

  const matchedKeywords = new Set<string>();
  let totalWeight = 0;
  let matchedWeight = 0;

  // 1. 描述关键词匹配（权重 40）
  const descKeywords = extractKeywords(skill.description);
  const descWeight = 40;
  totalWeight += descWeight;
  const descMatched = userKeywords.filter((kw) =>
    descKeywords.some((dk) => dk.includes(kw) || kw.includes(dk)),
  );
  if (descMatched.length > 0) {
    matchedWeight += descWeight * Math.min(descMatched.length / 3, 1);
    descMatched.forEach((kw) => matchedKeywords.add(kw));
  }

  // 2. 技能 id 匹配（权重 20）
  const idWeight = 20;
  totalWeight += idWeight;
  const idLower = skill.id.toLowerCase();
  const idMatched = userKeywords.filter((kw) => idLower.includes(kw));
  if (idMatched.length > 0) {
    matchedWeight += idWeight;
    idMatched.forEach((kw) => matchedKeywords.add(kw));
  }

  // 3. 技能名称匹配（权重 20）
  const nameWeight = 20;
  totalWeight += nameWeight;
  const nameLower = skill.name.toLowerCase();
  const nameMatched = userKeywords.filter((kw) => nameLower.includes(kw));
  if (nameMatched.length > 0) {
    matchedWeight += nameWeight;
    nameMatched.forEach((kw) => matchedKeywords.add(kw));
  }

  // 4. 关联工具匹配（权重 20）
  if (skill.tools && skill.tools.length > 0) {
    const toolsWeight = 20;
    totalWeight += toolsWeight;
    const toolsLower = skill.tools.map((t) => t.toLowerCase());
    const toolsMatched = userKeywords.filter((kw) =>
      toolsLower.some((t) => t.includes(kw) || kw.includes(t)),
    );
    if (toolsMatched.length > 0) {
      matchedWeight += toolsWeight * Math.min(toolsMatched.length / 2, 1);
      toolsMatched.forEach((kw) => matchedKeywords.add(kw));
    }
  }

  const score = totalWeight > 0 ? Math.round((matchedWeight / totalWeight) * 100) : 0;
  return { score, matchedKeywords: Array.from(matchedKeywords) };
}

// ── 推荐函数 ────────────────────────────────────────────────

export interface RecommendSkillsOptions {
  /** 最大返回数量（默认 5） */
  limit?: number;
  /** 最低分数阈值（默认 10） */
  minScore?: number;
  /** 按模式过滤 */
  mode?: SkillMode;
  /** 只推荐已启用的技能（默认 true） */
  onlyEnabled?: boolean;
}

/**
 * 根据用户输入推荐相关技能。
 *
 * @param userInput 用户输入文本
 * @param skills 可用技能列表
 * @param options 推荐选项
 * @returns 推荐结果列表，按分数降序排列
 */
export function recommendSkills(
  userInput: string,
  skills: SkillEntry[],
  options: RecommendSkillsOptions = {},
): SkillRecommendation[] {
  const { limit = 5, minScore = 10, mode, onlyEnabled = true } = options;

  if (!userInput.trim() || skills.length === 0) {
    return [];
  }

  // 提取用户输入关键词
  const userKeywords = extractKeywords(userInput);
  if (userKeywords.length === 0) {
    return [];
  }

  // 同义词扩展：将用户关键词扩展为同义词，提升推荐准确性
  const expandedKeywords = expandKeywords(userKeywords);

  // 过滤技能
  let filteredSkills = skills;
  if (onlyEnabled) {
    filteredSkills = filteredSkills.filter((s) => s.enabled);
  }
  if (mode) {
    filteredSkills = filteredSkills.filter(
      (s) => !s.modes || s.modes.includes(mode),
    );
  }

  // 计算每个技能的匹配分数
  const recommendations: SkillRecommendation[] = [];
  for (const skill of filteredSkills) {
    const { score, matchedKeywords } = calculateScore(expandedKeywords, skill);
    if (score >= minScore) {
      const reason = matchedKeywords.length > 0
        ? `匹配关键词: ${matchedKeywords.slice(0, 5).join(", ")}`
        : "语义匹配";
      recommendations.push({ skill, score, matchedKeywords, reason });
    }
  }

  // 按分数降序排列
  recommendations.sort((a, b) => b.score - a.score);

  // 限制返回数量
  return recommendations.slice(0, limit);
}

/**
 * 获取最推荐的单个技能。
 * 如果没有匹配的技能，返回 null。
 */
export function recommendTopSkill(
  userInput: string,
  skills: SkillEntry[],
  options: Omit<RecommendSkillsOptions, "limit"> = {},
): SkillRecommendation | null {
  const results = recommendSkills(userInput, skills, { ...options, limit: 1 });
  return results.length > 0 ? results[0] : null;
}
