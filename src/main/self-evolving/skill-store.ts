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
import { logger, LogTag } from "../logger";
import type {
  Skill,
  SkillListItem,
  SkillMetadata,
  SkillSource,
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
      case "source":
        metadata.source = value as SkillSource;
        break;
      case "sourceUrl":
        metadata.sourceUrl = value;
        break;
      case "mergedInto":
        metadata.mergedInto = value;
        break;
      case "protected":
        metadata.protected = value === "true" || value === "yes" || value === "1";
        break;
      case "enabled":
        metadata.enabled = value === "true" || value === "yes" || value === "1";
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
export function listSkills(options?: { includeArchived?: boolean }): SkillListItem[] {
  ensureSkillsRoot();
  const rootDir = getSkillsRootDir();
  const skillFiles = findAllSkillFiles(rootDir);
  const skills: SkillListItem[] = [];
  for (const filePath of skillFiles) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const metadata = parseSkillMetadata(content);
      if (metadata) {
        // 过滤掉已归档的技能（除非显式要求包含）
        const usage = getUsageRecord(metadata.name);
        if (usage?.status === "archived" && !options?.includeArchived) continue;
        const stat = fs.statSync(filePath);
        skills.push({
          name: metadata.name,
          description: metadata.description,
          category: metadata.category,
          // source 字段判断：有则用，无则根据 createdBy 判断
          source: metadata.source || (metadata.createdBy === "agent" ? "self-grown" : "external"),
          createdBy: metadata.createdBy,
          updatedAt: stat.mtime.toISOString(),
          // 没有 enabled 字段的技能默认启用
          enabled: metadata.enabled !== false,
          protected: metadata.protected,
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
        // Cyrene 原有的内置技能没有 source 字段，自动标记为 protected（系统内置受保护）
        if (!metadata.source && metadata.protected === undefined) {
          metadata.protected = true;
          metadata.source = "external";
        }
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
  // 自动补充 createdAt、updatedAt、source（默认 self-grown）
  const now = new Date().toISOString();
  let finalContent = content;
  if (!/createdAt\s*:/.test(finalContent)) {
    finalContent = finalContent.replace(/^---\n/, `---\ncreatedAt: ${now}\n`);
  }
  if (!/updatedAt\s*:/.test(finalContent)) {
    finalContent = finalContent.replace(/^---\n/, `---\nupdatedAt: ${now}\n`);
  }
  if (!/source\s*:/.test(finalContent)) {
    finalContent = finalContent.replace(/^---\n/, `---\nsource: self-grown\n`);
  }
  fs.writeFileSync(skillFile, finalContent, "utf-8");
  // 记录使用情况
  updateUsageRecord(name, { createdBy: "agent" });
  return { success: true, message: `技能 '${name}' 创建成功` };
}

/**
 * 解析 GitHub 仓库 URL，提取 user、repo、branch、path。
 * 支持格式：
 * - https://github.com/user/repo/tree/branch/path/to/skill
 * - https://github.com/user/repo/blob/branch/path/to/SKILL.md
 */
function parseGitHubRepoUrl(url: string): { user: string; repo: string; branch: string; path: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 3) return null;
    const user = parts[0];
    const repo = parts[1].replace(/\.git$/, "");
    if (parts[2] === "tree" || parts[2] === "blob") {
      const branch = parts[3];
      const path = parts.slice(4).join("/");
      return { user, repo, branch, path };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 通过 GitHub API 获取仓库目录树，返回文件路径列表。
 */
async function fetchGitHubRepoTree(user: string, repo: string, branch: string): Promise<string[] | null> {
  try {
    const apiUrl = `https://api.github.com/repos/${user}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
    const response = await fetch(apiUrl, {
      headers: {
        "User-Agent": "Cyrene-Agent/1.0",
        "Accept": "application/vnd.github.v3+json",
      },
    });
    if (!response.ok) {
      logger.warn(LogTag.Skills, `GitHub API 获取目录树失败: HTTP ${response.status}`);
      return null;
    }
    const data = await response.json() as { tree?: Array<{ path: string; type: string }> };
    if (!data.tree) return null;
    return data.tree.filter((item) => item.type === "blob").map((item) => item.path);
  } catch (err) {
    logger.warn(LogTag.Skills, `GitHub API 获取目录树异常: ${err}`);
    return null;
  }
}

/**
 * 从 URL 安装外部技能（GitHub raw URL 或 GitHub 仓库 URL 或直接 SKILL.md URL）。
 * - GitHub 仓库 URL：通过 API 获取目录树，下载整个技能目录（含附件）
 * - raw URL / 直接 URL：只下载单个 SKILL.md
 * 安装后自动标记 source=external 和 sourceUrl。
 *
 * @param url 技能的 URL（支持 github.com 仓库 URL、raw.githubusercontent.com、直接 SKILL.md URL）
 * @returns 安装结果
 */
export async function installSkillFromUrl(url: string): Promise<{ success: boolean; message?: string; error?: string; skillName?: string }> {
  try {
    // 验证 URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return { success: false, error: "无效的 URL" };
    }

    let skillContent: string | null = null;
    let attachmentFiles: Array<{ relativePath: string; content: string }> = [];
    let sourceUrl = url;

    // 检测是否是 GitHub 仓库 URL
    const ghInfo = parseGitHubRepoUrl(url);
    if (ghInfo) {
      logger.info(LogTag.Skills, `检测到 GitHub 仓库 URL: ${ghInfo.user}/${ghInfo.repo}@${ghInfo.branch}/${ghInfo.path}`);
      sourceUrl = `https://github.com/${ghInfo.user}/${ghInfo.repo}/tree/${ghInfo.branch}/${ghInfo.path}`;

      // 通过 GitHub API 获取目录树
      const tree = await fetchGitHubRepoTree(ghInfo.user, ghInfo.repo, ghInfo.branch);
      if (tree) {
        // 过滤出目标路径下的文件
        const targetPath = ghInfo.path ? `${ghInfo.path}/` : "";
        const targetFiles = tree.filter((p) => p.startsWith(targetPath) || p === `${ghInfo.path}/SKILL.md`);

        if (targetFiles.length > 0) {
          // 下载所有文件
          const rawBase = `https://raw.githubusercontent.com/${ghInfo.user}/${ghInfo.repo}/${ghInfo.branch}/`;
          for (const filePath of targetFiles) {
            const fileUrl = rawBase + filePath;
            try {
              const resp = await fetch(fileUrl, { headers: { "User-Agent": "Cyrene-Agent/1.0" } });
              if (resp.ok) {
                const content = await resp.text();
                const relativePath = filePath.slice(targetPath.length);
                if (relativePath === "SKILL.md" || filePath.endsWith("/SKILL.md")) {
                  skillContent = content;
                } else {
                  attachmentFiles.push({ relativePath, content });
                }
              }
            } catch {
              // 跳过下载失败的文件
            }
          }
          logger.info(LogTag.Skills, `GitHub 仓库下载完成: SKILL.md=${skillContent ? "有" : "无"}, 附件=${attachmentFiles.length} 个`);
        }
      }

      // 如果 API 方式失败，回退到直接下载 SKILL.md
      if (!skillContent) {
        logger.info(LogTag.Skills, `GitHub API 方式未获取到 SKILL.md，回退到直接下载`);
        const skillMdUrl = `https://raw.githubusercontent.com/${ghInfo.user}/${ghInfo.repo}/${ghInfo.branch}/${ghInfo.path}/SKILL.md`;
        const resp = await fetch(skillMdUrl, { headers: { "User-Agent": "Cyrene-Agent/1.0" } });
        if (resp.ok) {
          skillContent = await resp.text();
        }
      }
    } else {
      // 非 GitHub 仓库 URL，直接下载（假设是 SKILL.md raw URL）
      const response = await fetch(url, {
        headers: { "User-Agent": "Cyrene-Agent/1.0" },
      });
      if (!response.ok) {
        return { success: false, error: `下载失败：HTTP ${response.status}` };
      }
      skillContent = await response.text();
    }

    if (!skillContent || skillContent.length < 10) {
      return { success: false, error: "下载的 SKILL.md 内容为空或无效" };
    }

    // 解析技能元数据
    const metadata = parseSkillMetadata(skillContent);
    if (!metadata || !metadata.name) {
      return { success: false, error: "无法解析技能名称，请确保 SKILL.md 包含 name 字段" };
    }

    // 检查是否已存在
    if (skillExists(metadata.name)) {
      return { success: false, error: `技能 '${metadata.name}' 已存在` };
    }

    // 自动补充 source 和 sourceUrl（如果用户没指定）
    let finalContent = skillContent;
    if (!/source\s*:/.test(finalContent)) {
      finalContent = finalContent.replace(/^---\n/, `---\nsource: external\n`);
    }
    if (!/sourceUrl\s*:/.test(finalContent)) {
      finalContent = finalContent.replace(/^---\n/, `---\nsourceUrl: ${sourceUrl}\n`);
    }

    // 创建目录和文件
    ensureSkillsRoot();
    const skillDir = path.join(getSkillsRootDir(), metadata.name);
    fs.mkdirSync(skillDir, { recursive: true });
    const skillFile = path.join(skillDir, "SKILL.md");
    fs.writeFileSync(skillFile, finalContent, "utf-8");

    // 保存附件文件
    for (const attachment of attachmentFiles) {
      const attachmentPath = path.join(skillDir, attachment.relativePath);
      const attachmentDir = path.dirname(attachmentPath);
      if (!fs.existsSync(attachmentDir)) {
        fs.mkdirSync(attachmentDir, { recursive: true });
      }
      fs.writeFileSync(attachmentPath, attachment.content, "utf-8");
    }

    // 记录使用情况
    updateUsageRecord(metadata.name, { createdBy: "user" });

    logger.info(LogTag.Skills, `外部技能安装成功：${metadata.name} (来自 ${sourceUrl}, 附件 ${attachmentFiles.length} 个)`);

    return {
      success: true,
      message: `技能 '${metadata.name}' 安装成功（来源：${parsedUrl.hostname}${attachmentFiles.length > 0 ? `，含 ${attachmentFiles.length} 个附件` : ""}）`,
      skillName: metadata.name,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn(LogTag.Skills, `外部技能安装失败：${errorMsg}`);
    return { success: false, error: `安装失败：${errorMsg}` };
  }
}

/**
 * 检查外部技能是否有更新（比较远程 SKILL.md 和本地内容）。
 * 只支持 source=external 且有 sourceUrl 的技能。
 */
export async function checkSkillUpdate(name: string): Promise<{ success: boolean; hasUpdate?: boolean; message?: string; error?: string }> {
  try {
    const skill = getSkill(name);
    if (!skill) {
      return { success: false, error: `技能 '${name}' 不存在` };
    }
    if (skill.source !== "external" || !skill.sourceUrl) {
      return { success: false, error: `技能 '${name}' 不是外部技能或没有 sourceUrl，无法检查更新` };
    }

    // 解析 sourceUrl，构造 SKILL.md 的 raw URL
    let skillMdUrl: string | null = null;
    const ghInfo = parseGitHubRepoUrl(skill.sourceUrl);
    if (ghInfo) {
      skillMdUrl = `https://raw.githubusercontent.com/${ghInfo.user}/${ghInfo.repo}/${ghInfo.branch}/${ghInfo.path}/SKILL.md`;
    } else if (skill.sourceUrl.includes("raw.githubusercontent.com")) {
      skillMdUrl = skill.sourceUrl;
    } else if (skill.sourceUrl.endsWith("/SKILL.md")) {
      skillMdUrl = skill.sourceUrl;
    }

    if (!skillMdUrl) {
      return { success: false, error: `无法从 sourceUrl 构造 SKILL.md 下载链接: ${skill.sourceUrl}` };
    }

    // 下载远程 SKILL.md
    const response = await fetch(skillMdUrl, { headers: { "User-Agent": "Cyrene-Agent/1.0" } });
    if (!response.ok) {
      return { success: false, error: `下载远程 SKILL.md 失败：HTTP ${response.status}` };
    }
    const remoteContent = await response.text();

    // 比较内容（忽略 frontmatter 中的 source/sourceUrl/updatedAt 字段）
    const normalizeContent = (content: string) =>
      content
        .replace(/source\s*:.*\n/g, "")
        .replace(/sourceUrl\s*:.*\n/g, "")
        .replace(/updatedAt\s*:.*\n/g, "")
        .replace(/\r\n/g, "\n")
        .trim();

    const localNormalized = normalizeContent(skill.content);
    const remoteNormalized = normalizeContent(remoteContent);
    const hasUpdate = localNormalized !== remoteNormalized;

    return {
      success: true,
      hasUpdate,
      message: hasUpdate ? `技能 '${name}' 有可用更新` : `技能 '${name}' 已是最新版本`,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn(LogTag.Skills, `检查技能更新失败: ${errorMsg}`);
    return { success: false, error: `检查更新失败: ${errorMsg}` };
  }
}

/**
 * 更新外部技能到最新版本（备份旧版本，下载新版本）。
 * 只支持 source=external 且有 sourceUrl 的技能。
 */
export async function updateSkill(name: string): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const skill = getSkill(name);
    if (!skill) {
      return { success: false, error: `技能 '${name}' 不存在` };
    }
    if (skill.source !== "external" || !skill.sourceUrl) {
      return { success: false, error: `技能 '${name}' 不是外部技能或没有 sourceUrl，无法更新` };
    }

    // 先备份当前技能（直接复制到备份目录，避免循环依赖）
    try {
      const backupDir = path.join(getSkillsRootDir(), "..", "skills-curator-backups");
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = path.join(backupDir, `skills-${timestamp}`);
      fs.cpSync(skill.dirPath, backupPath, { recursive: true });
      logger.info(LogTag.Skills, `更新前自动备份: ${backupPath}`);
    } catch (backupErr) {
      logger.warn(LogTag.Skills, `更新前备份失败: ${backupErr}`);
    }

    // 删除旧技能（保留备份）
    const skillDir = skill.dirPath;
    fs.rmSync(skillDir, { recursive: true, force: true });
    removeUsageRecord(name);

    // 重新安装（用 sourceUrl）
    const installResult = await installSkillFromUrl(skill.sourceUrl);
    if (!installResult.success) {
      // 安装失败，尝试从备份恢复
      logger.warn(LogTag.Skills, `更新失败，尝试从备份恢复: ${installResult.error}`);
      return { success: false, error: `更新失败: ${installResult.error}（旧版本已备份，可手动恢复）` };
    }

    logger.info(LogTag.Skills, `技能更新成功: ${name}`);
    return {
      success: true,
      message: `技能 '${name}' 已更新到最新版本（旧版本已备份）`,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn(LogTag.Skills, `技能更新失败: ${errorMsg}`);
    return { success: false, error: `更新失败: ${errorMsg}` };
  }
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
 * 设置技能启用/禁用状态。
 * 修改 SKILL.md frontmatter 中的 enabled 字段。
 */
export function setSkillEnabled(name: string, enabled: boolean): { success: boolean; message?: string; error?: string } {
  const skill = getSkill(name);
  if (!skill) {
    return { success: false, error: `技能 '${name}' 不存在` };
  }

  try {
    let content = skill.content;

    // 检查 frontmatter 中是否已有 enabled 字段
    const enabledRegex = /^enabled:\s*(true|false|yes|no|1|0)\s*$/m;
    if (enabledRegex.test(content)) {
      // 替换已有的 enabled 字段
      content = content.replace(enabledRegex, `enabled: ${enabled ? "true" : "false"}`);
    } else {
      // 在 frontmatter 中添加 enabled 字段（在 name 字段之后）
      content = content.replace(/^(name:\s*.+)$/m, `$1\nenabled: ${enabled ? "true" : "false"}`);
    }

    // 写回文件
    fs.writeFileSync(skill.filePath, content, "utf-8");

    return {
      success: true,
      message: `技能 '${name}' 已${enabled ? "启用" : "禁用"}`,
    };
  } catch (err) {
    return { success: false, error: `写入失败: ${String(err)}` };
  }
}

/**
 * 启用技能。
 */
export function enableSkill(name: string) {
  return setSkillEnabled(name, true);
}

/**
 * 禁用技能。
 */
export function disableSkill(name: string) {
  return setSkillEnabled(name, false);
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
  // 检查是否为系统内置受保护技能
  if (skill.protected) {
    return { success: false, error: `技能 '${name}' 是系统内置受保护技能，不能删除。如需修改请用 edit，如需替换请先 fork` };
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

/** 记录技能使用成功（Agent 反馈使用该技能后任务成功）。 */
export function recordSkillSuccess(name: string): void {
  updateUsageRecord(name, {
    lastSuccessAt: new Date().toISOString(),
    successCount: 1,
    lastUsedAt: new Date().toISOString(),
    useCount: 1,
  });
}

/** 记录技能使用失败（Agent 反馈使用该技能后任务失败，技能可能有问题）。 */
export function recordSkillFailure(name: string): void {
  updateUsageRecord(name, {
    lastFailureAt: new Date().toISOString(),
    failureCount: 1,
    lastUsedAt: new Date().toISOString(),
    useCount: 1,
  });
}
