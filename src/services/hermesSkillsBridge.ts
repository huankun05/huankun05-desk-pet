/**
 * Hermes 技能 → desk-pet Behavior 系统桥接
 *
 * 监听 Hermes Gateway 的 slash 技能事件（如 /help, /status），
 * 将其映射到 BehaviorRegistry 的事件分发系统。
 *
 * 技能映射表由服务端管理（data/hermes_skill_map.json），
 * 前端仅负责：检测技能调用 → 分发行为事件。
 */

import { createLogger } from '../utils/logger';
import { eventBus } from './eventBus';
import { getBehaviorRegistry } from './behavior/registry';
import { EventType } from './behavior/types';

const log = createLogger('HermesSkillsBridge');

export interface HermesSkill {
  command: string;
  behavior_event: string;
  description: string;
  is_builtin: boolean;
}

const SKILL_MAP_CACHE_KEY = 'deskpet_hermes_skill_map';

/**
 * 检测文本是否为技能调用，如果是则通过 BehaviorRegistry 分发。
 * 在 Hermes Gateway 的 onToken 回调中调用。
 *
 * @returns 是否匹配到技能
 */
export function detectAndDispatchSkill(text: string): boolean {
  const trimmed = text.trim().toLowerCase();

  // 只处理以 / 开头的消息
  if (!trimmed.startsWith('/')) return false;

  const cmd = trimmed.split(' ')[0];
  const args = trimmed.slice(cmd.length).trim();

  // 从缓存加载技能映射
  const skillMap = loadSkillMapCache();
  const behaviorEvent = skillMap[cmd];

  if (!behaviorEvent) return false;

  log.info('Skill detected & dispatched', { command: cmd, behaviorEvent, args });

  // 通过事件总线 + BehaviorRegistry 分发
  const registry = getBehaviorRegistry();

  // 根据行为事件类型映射到 EventType
  const eventType = mapBehaviorToEventType(behaviorEvent);

  if (eventType) {
    registry.dispatch(eventType, { command: cmd, args, behaviorEvent }).catch((err) => {
      log.warn('Skill dispatch failed', { err: String(err) });
    });
  }

  // 同时通过事件总线发射，方便其他模块监听
  eventBus.emit('hermes:skill', { command: cmd, args, behaviorEvent });

  return true;
}

/**
 * 从服务端加载技能列表（通过 Hermes Gateway REST API）
 */
export async function fetchSkillsFromServer(): Promise<HermesSkill[]> {
  try {
    const res = await fetch('http://127.0.0.1:8765/api/gateway/skills', {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const skills = (await res.json()) as HermesSkill[];
    // 更新缓存
    cacheSkillMap(skills);
    return skills;
  } catch {
    log.warn('Failed to fetch skills from server');
    return [];
  }
}

// ===== 内部 =====

function loadSkillMapCache(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SKILL_MAP_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function cacheSkillMap(skills: HermesSkill[]): void {
  const map: Record<string, string> = {};
  for (const s of skills) {
    map[s.command] = s.behavior_event;
  }
  try {
    localStorage.setItem(SKILL_MAP_CACHE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function mapBehaviorToEventType(behaviorEvent: string): EventType | null {
  const mapping: Record<string, EventType> = {
    show_help: EventType.INIT,
    show_status: EventType.INIT,
    show_emotion: EventType.EMOTION_CHANGED,
    search_memory: EventType.MESSAGE_SENT,
    clear_context: EventType.MESSAGE_SENT,
    reset_personality: EventType.PERSONA_CHANGED,
    show_time: EventType.TIMER,
    trigger_dance: EventType.DOUBLE_CLICK,
    request_pet: EventType.INTERACTION_PAT,
    enter_sleep: EventType.IDLE,
  };
  return mapping[behaviorEvent] ?? null;
}
