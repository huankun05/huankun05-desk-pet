/**
 * 角色配置类型定义与规范化逻辑。
 *
 * 每个角色包含唯一 ID、显示名称和 Live2D 模型相对路径。
 * 后续可扩展：角色专属 prompts 目录、语音配置、情绪系统配置等。
 *
 * 设计原则：
 * - 本文件只放纯类型 + 无副作用的 normalize 函数，main 和 renderer 都可引用。
 * - 涉及磁盘读写 / 设置加载的逻辑放在 main/character/character-manager.ts。
 */

/** 单个角色的完整配置。 */
export interface CharacterConfig {
  /** 角色唯一 ID，如 "cyrene"。用作目录名和配置键。 */
  id: string;
  /** 显示名称，如 "昔涟"。 */
  name: string;
  /** Live2D 模型相对路径（相对于 assets/models/），如 "cyrene/Cyrene.model3.json"。 */
  modelPath: string;
  /**
   * 角色专属 prompts 目录（相对于项目根目录），可选。
   * 第一版暂不使用，后续实现角色专属人设时启用。
   */
  promptsDir?: string;
}

/** 默认角色 ID。 */
export const DEFAULT_CHARACTER_ID = "cyrene";

/** 默认角色配置（昔涟）。 */
export const DEFAULT_CHARACTER: CharacterConfig = {
  id: DEFAULT_CHARACTER_ID,
  name: "昔涟",
  modelPath: "cyrene/Cyrene.model3.json",
};

/** 规范化角色 ID：非空字符串，去除首尾空格；非法值回退到默认 ID。 */
export function normalizeCharacterId(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_CHARACTER_ID;
  const trimmed = value.trim();
  return trimmed || DEFAULT_CHARACTER_ID;
}

/** 规范化单个角色配置。非法字段回退到默认值。 */
export function normalizeCharacterConfig(input: unknown): CharacterConfig {
  if (!input || typeof input !== "object") return { ...DEFAULT_CHARACTER };
  const raw = input as Record<string, unknown>;
  const id = normalizeCharacterId(raw.id);
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id;
  const modelPath =
    typeof raw.modelPath === "string" && raw.modelPath.trim()
      ? raw.modelPath.trim()
      : DEFAULT_CHARACTER.modelPath;
  const result: CharacterConfig = { id, name, modelPath };
  if (typeof raw.promptsDir === "string" && raw.promptsDir.trim()) {
    result.promptsDir = raw.promptsDir.trim();
  }
  return result;
}

/**
 * 规范化角色列表：
 * - 过滤非法值
 * - 按 id 去重（保留第一个出现的）
 * - 至少保留默认角色
 * - 确保默认角色在列表中（不在则插到最前）
 */
export function normalizeCharacterList(input: unknown): CharacterConfig[] {
  if (!Array.isArray(input)) return [{ ...DEFAULT_CHARACTER }];
  const seen = new Set<string>();
  const result: CharacterConfig[] = [];
  for (const item of input) {
    const config = normalizeCharacterConfig(item);
    if (seen.has(config.id)) continue;
    seen.add(config.id);
    result.push(config);
  }
  if (result.length === 0) return [{ ...DEFAULT_CHARACTER }];
  if (!seen.has(DEFAULT_CHARACTER_ID)) {
    result.unshift({ ...DEFAULT_CHARACTER });
  }
  return result;
}
