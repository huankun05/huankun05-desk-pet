// skill-store —— 自进化技能存储引擎。
// 负责技能的持久化存储、读取、验证、目录管理。
// 技能存储在用户数据目录下的 skills/ 文件夹，每个技能是一个目录，包含 SKILL.md。
//
// 存储结构：
//   <userData>/skills/
//   ├── my-skill/
//   │   └── SKILL.md
//   ├── category-name/
//   │   └── another-skill/
//   │       └── SKILL.md
//   └── .usage.json  (技能使用记录)

import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";
import type {
  Skill,
  SkillListItem,
  SkillMetadata,
  SkillUsageRecord,
  SkillValidationError,
} from "./skill-types";

/** 技能名称允许的字符（小写字母、数字、连字符、下划线、点）。 */
const VALID_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;
/** 技能名称最大长度。 */
const MAX_NAME_LENGTH = 64;
/** 技能描述最大长度。 */
const MAX_DESCRIPTION_LENGTH = 1024;
/** SKILL.md 内容最大字符数。 */
const MAX_CONTENT_CHARS = 100_000;

/** 获取技能根目录（用户数据目录下的 skills/）。 */
export function getSkillsRootDir(): string {
  const userDataDir = app.getPath("userData");
  return path.join(userDataDir, "skills");
}

/** 获取技能使用记录文件路径。 */
function getUsageFilePath(): string {
  return path.join(getSkillsRootDir(), ".usage.json");
}

/** 确保技能根目录存在。 */
function ensureSkillsRoot(): void {
  const dir = getSkillsRootDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 验证技能名称。
 * 返回错误信息数组，空数组表示验证通过。
 */
export function validateSkillName(name: string): SkillValidationError[] {
  const errors: SkillValidationError[] = [];
  if (!name || name.trim().length === 0) {
    errors.push({ field: "name", message: "技能名称不能为空" });
    return errors;
  }
  if (name.length > MAX_NAME_LENGTH) {
    errors.push({ field: "name", message: `技能名称不能超过 ${MAX_NAME_LENGTH} 个字符` });
  }
  if (!VALID_NAME_RE.test(name)) {
    errors.push({
      field: "name",
      message: "技能名称只能包含小写字母、数字、连字符、下划线和点，且必须以字母或数字开头",
    });
  }
  return errors;
}

/**
 * 验证 SKILL.md 内容的 frontmatter 格式。
 * 要求以 --- 开头，包含 name 和 description 字段。
 */
export function validateSkillContent(content: string): SkillValidationError[] {
  const errors: SkillValidationError[] = [];
  if (!content || content.trim().length === 0) {
    errors.push({ field: "content", message: "SKILL.md 内容不能为空" });
    return errors;
  }
  if (content.length > MAX_CONTENT_CHARS) {
    errors.push({ field: "content", message: `SKILL.md 内容不能超过 ${MAX_CONTENT_CHARS} 个字符` });
  }
  if (!content.startsWith("---")) {
    errors.push({ field: "content", message: "SKILL.md 必须以 YAML frontmatter (---) 开头" });
    return errors;
  }
  // 查找 frontmatter 结束标记
  const endMatch = content.slice(3).match(/\n---\s*\n/);
  if (!endMatch) {
    errors.push({ field: "content", message: "SKILL.md frontmatter 没有正确闭合（缺少 ---）" });
    return errors;
  }
  // 简单解析 frontmatter，检查 name 和 description
  const fmContent = content.slice(3, endMatch.index! + 3);
  if (!/name\s*:/.test(fmContent)) {
    errors.push({ field: "content", message: "frontmatter 必须包含 name 字段" });
  }
  if (!/description\s*:/.test(fmContent)) {
    errors.push({ field: "content", message: "frontmatter 必须包含 description 字段" });
  }
  // 检查 body 部分
  const body = content.slice(endMatch.index! + 3 + endMatch[0].length).trim();
  if (body.length === 0) {
    errors.push({ field: "content", message: "SKILL.md frontmatter 之后必须有内容（操作步骤、说明等）" });
  }
  return errors;
}

/**
 * 从 SKILL.md 内容中解析元数据。
 * 简单的 YAML frontmatter 解析，不依赖外部库。
 */
export function parseSkillMetadata(content: string): SkillMetadata | null {
  if (!content.startsWith("---")) return null;
  const endMatch = content.slice(3).match(/\n---\s*\n/);
  if (!endMatch) return null;
  const fmContent = content.slice(3, endMatch.index! + 3);
  const metadata: SkillMetadata = { name: "", description: "" };
  // 逐行解析简单的 key: value
  for (const line of fmContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx <= 0) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();
    // 去除引号
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    switch (key) {
      case "name":
        metadata.name = value;
        break;
      case "description":
        metadata.description = value;
        break;
      case "category":
        metadata.category = value;
        break;
      case "version":
        metadata.version = value;
        break;
      case "tags":
        metadata.tags = value.split(",").map((t) => t.trim()).filter(Boolean);
        break;
      case "createdBy":
        metadata.createdBy = value as "user" | "agent";
        break;
      case "createdAt":
        metadata.createdAt = value;
        break;
      case "updatedAt":
        metadata.updatedAt = value;
        break;
    }
  }
  return metadata.name ? metadata : null;
}

/**
 * 递归查找技能根目录下所有的 SKILL.md 文件。
 */
function findAllSkillFiles(rootDir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(rootDir)) return results;
  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // 跳过隐藏目录（如 .archive）
        if (entry.name.startsWith(".")) continue;
        walk(fullPath);
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        results.push(fullPath);
      }
    }
  };
  walk(rootDir);
  return results;
}

/**
 * 列出所有技能（不含完整内容，只含元数据）。
 */
export function listSkills(): SkillListItem[] {
  ensureSkillsRoot();
  const rootDir = getSkillsRootDir();
  const skillFiles = findAllSkillFiles(rootDir);
  const skills: SkillListItem[] = [];
  for (const filePath of skillFiles) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const metadata = parseSkillMetadata(content);
      if (metadata) {
        const stat = fs.statSync(filePath);
        skills.push({
          name: metadata.name,
          description: metadata.description,
          category: metadata.category,
          createdBy: metadata.createdBy,
          updatedAt: stat.mtime.toISOString(),
        });
      }
    } catch {
      // 跳过无法读取的技能
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 按名称查找技能，返回完整内容。
 */
export function getSkill(name: string): Skill | null {
  ensureSkillsRoot();
  const rootDir = getSkillsRootDir();
  const skillFiles = findAllSkillFiles(rootDir);
  for (const filePath of skillFiles) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const metadata = parseSkillMetadata(content);
      if (metadata && metadata.name === name) {
        const stat = fs.statSync(filePath);
        return {
          ...metadata,
          content,
          dirPath: path.dirname(filePath),
          filePath,
          updatedAt: stat.mtime.toISOString(),
        };
      }
    } catch {
      // 跳过
    }
  }
  return null;
}

/**
 * 检查技能是否存在。
 */
export function skillExists(name: string): boolean {
  return getSkill(name) !== null;
}

/**
 * 创建新技能。
 * 返回 { success, message, error }
 */
export function createSkill(name: string, content: string): { success: boolean; message?: string; error?: string } {
  // 验证名称
  const nameErrors = validateSkillName(name);
  if (nameErrors.length > 0) {
    return { success: false, error: nameErrors.map((e) => e.message).join("; ") };
  }
  // 验证内容
  const contentErrors = validateSkillContent(content);
  if (contentErrors.length > 0) {
    return { success: false, error: contentErrors.map((e) => e.message).join("; ") };
  }
  // 检查是否已存在
  if (skillExists(name)) {
    return { success: false, error: `技能 '${name}' 已存在，请使用 edit 或 patch 修改` };
  }
  // 创建目录和文件
  ensureSkillsRoot();
  const skillDir = path.join(getSkillsRootDir(), name);
  fs.mkdirSync(skillDir, { recursive: true });
  const skillFile = path.join(skillDir, "SKILL.md");
  // 自动补充 createdAt 和 updatedAt
  const now = new Date().toISOString();
  let finalContent = content;
  if (!/createdAt\s*:/.test(finalContent)) {
    finalContent = finalContent.replace(/^---\n/, `---\ncreatedAt: ${now}\n`);
  }
  if (!/updatedAt\s*:/.test(finalContent)) {
    finalContent = finalContent.replace(/^---\n/, `---\nupdatedAt: ${now}\n`);
  }
  fs.writeFileSync(skillFile, finalContent, "utf-8");
  // 记录使用情况
  updateUsageRecord(name, { createdBy: "agent" });
  return { success: true, message: `技能 '${name}' 创建成功` };
}

/**
 * 编辑技能（完整替换 SKILL.md 内容）。
 */
export function editSkill(name: string, content: string): { success: boolean; message?: string; error?: string } {
  const skill = getSkill(name);
  if (!skill) {
    return { success: false, error: `技能 '${name}' 不存在` };
  }
  const contentErrors = validateSkillContent(content);
  if (contentErrors.length > 0) {
    return { success: false, error: contentErrors.map((e) => e.message).join("; ") };
  }
  // 自动更新 updatedAt
  const now = new Date().toISOString();
  let finalContent = content;
  finalContent = finalContent.replace(/updatedAt\s*:.*\n/, `updatedAt: ${now}\n`);
  if (!/updatedAt\s*:/.test(finalContent)) {
    finalContent = finalContent.replace(/^---\n/, `---\nupdatedAt: ${now}\n`);
  }
  fs.writeFileSync(skill.filePath, finalContent, "utf-8");
  // 记录修改
  updateUsageRecord(name, { lastPatchedAt: now, patchCount: 1 });
  return { success: true, message: `技能 '${name}' 更新成功` };
}

/**
 * 删除技能。
 */
export function deleteSkill(name: string): { success: boolean; message?: string; error?: string } {
  const skill = getSkill(name);
  if (!skill) {
    return { success: false, error: `技能 '${name}' 不存在` };
  }
  // 检查是否被 pin
  const usage = getUsageRecord(name);
  if (usage?.pinned) {
    return { success: false, error: `技能 '${name}' 已被 pin，不能删除。请先 unpin` };
  }
  // 删除目录
  fs.rmSync(skill.dirPath, { recursive: true, force: true });
  // 删除使用记录
  removeUsageRecord(name);
  return { success: true, message: `技能 '${name}' 删除成功` };
}

// ── 使用记录管理 ──────────────────────────────────────────────

/** 读取所有技能使用记录。 */
function loadUsageRecords(): Record<string, SkillUsageRecord> {
  const filePath = getUsageFilePath();
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

/** 保存所有技能使用记录。 */
function saveUsageRecords(records: Record<string, SkillUsageRecord>): void {
  ensureSkillsRoot();
  const filePath = getUsageFilePath();
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2), "utf-8");
}

/** 获取单个技能的使用记录。 */
export function getUsageRecord(name: string): SkillUsageRecord | undefined {
  const records = loadUsageRecords();
  return records[name];
}

/** 更新单个技能的使用记录（增量更新）。 */
export function updateUsageRecord(name: string, updates: Partial<SkillUsageRecord>): void {
  const records = loadUsageRecords();
  const existing = records[name] || { name, viewCount: 0, useCount: 0, patchCount: 0 };
  const updated: SkillUsageRecord = {
    ...existing,
    ...updates,
    viewCount: existing.viewCount + (updates.viewCount || 0),
    useCount: existing.useCount + (updates.useCount || 0),
    patchCount: existing.patchCount + (updates.patchCount || 0),
  };
  records[name] = updated;
  saveUsageRecords(records);
}

/** 删除单个技能的使用记录。 */
function removeUsageRecord(name: string): void {
  const records = loadUsageRecords();
  delete records[name];
  saveUsageRecords(records);
}

/** 记录技能被查看。 */
export function recordSkillViewed(name: string): void {
  updateUsageRecord(name, { lastViewedAt: new Date().toISOString(), viewCount: 1 });
}

/** 记录技能被使用。 */
export function recordSkillUsed(name: string): void {
  updateUsageRecord(name, { lastUsedAt: new Date().toISOString(), useCount: 1 });
}
