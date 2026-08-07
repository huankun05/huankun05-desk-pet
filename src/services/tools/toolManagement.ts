/**
 * 工具禁用状态管理
 *
 * 用户在「工具管理」页可临时禁用某些工具，状态持久化到 localStorage，
 * 每次发消息时随载荷上报给 Gateway，由后端在拼装 tools 时剔除。
 */

const DISABLED_TOOLS_KEY = 'deskpet_disabled_tools';

function read(): string[] {
  try {
    const raw = localStorage.getItem(DISABLED_TOOLS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function write(list: string[]): void {
  try {
    localStorage.setItem(DISABLED_TOOLS_KEY, JSON.stringify(list));
  } catch {
    /* 忽略配额/隐私模式异常 */
  }
}

/** 当前被禁用的工具名列表 */
export function getDisabledTools(): string[] {
  return read();
}

/** 判断某工具是否被禁用 */
export function isToolDisabled(name: string): boolean {
  return read().includes(name);
}

/** 设置工具禁用状态（持久化） */
export function setToolDisabled(name: string, disabled: boolean): void {
  const list = read();
  const has = list.includes(name);
  if (disabled && !has) {
    list.push(name);
    write(list);
  } else if (!disabled && has) {
    write(list.filter((n) => n !== name));
  }
}
