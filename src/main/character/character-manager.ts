/**
 * 角色管理器：加载当前角色配置，提供角色相关的查询 API。
 *
 * 第一版范围：
 * - 从 general-settings 读取 currentCharacterId
 * - 返回对应角色配置（含 Live2D 模型路径）
 * - 提供角色列表查询
 *
 * 后续可扩展：
 * - 角色热切换（不重启生效）
 * - 角色专属 prompts 目录注入到 external-content-paths
 * - 角色专属语音 / 情绪系统配置
 * - 角色管理 UI（增删改角色）
 */

import { loadGeneralSettings } from "../settings/settings-facade";
import type { CharacterConfig } from "../../shared/character-types";
import {
  DEFAULT_CHARACTER,
  DEFAULT_CHARACTER_ID,
} from "../../shared/character-types";

/**
 * 获取当前选中的角色配置。
 * 如果 currentCharacterId 不在角色列表中，回退到列表第一个；
 * 列表为空时回退到默认角色。
 */
export function getCurrentCharacter(): CharacterConfig {
  const settings = loadGeneralSettings();
  const characters: CharacterConfig[] = settings.characters?.length
    ? settings.characters
    : [{ ...DEFAULT_CHARACTER }];
  const currentId = settings.currentCharacterId ?? DEFAULT_CHARACTER_ID;
  const found = characters.find((c) => c.id === currentId);
  return found ?? characters[0] ?? { ...DEFAULT_CHARACTER };
}

/** 获取当前角色的 Live2D 模型相对路径（相对于 assets/models/）。 */
export function getCurrentCharacterModelPath(): string {
  return getCurrentCharacter().modelPath;
}

/** 获取所有可用角色列表。 */
export function getCharacterList(): CharacterConfig[] {
  const settings = loadGeneralSettings();
  return settings.characters?.length
    ? settings.characters
    : [{ ...DEFAULT_CHARACTER }];
}

/** 获取当前角色 ID。 */
export function getCurrentCharacterId(): string {
  return getCurrentCharacter().id;
}
