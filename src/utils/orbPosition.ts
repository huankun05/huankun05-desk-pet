import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

/**
 * 悬浮球窗口尺寸（逻辑像素）。
 *
 * 关键：窗口只比可见内容略大一点（收起=小圆，展开=面板），
 * 千万不要再开一个 300×420 的大窗口——透明区没设 pointer-events 时会整片捕获点击，
 * 导致周围桌面/角色点不到，视觉上也像一圈窗框阴影。
 */
export const ORB_COLLAPSED_W = 60;
export const ORB_COLLAPSED_H = 60;
export const ORB_EXPANDED_W = 176;
export const ORB_EXPANDED_H = 272;

/** 悬浮球位置持久化 key（绝对屏幕坐标，逻辑像素） */
export const ORB_POS_KEY = 'deskpet_orb_pos';
/** 默认贴角色放置时的间隙（逻辑像素） */
export const ORB_GAP = 8;

/** 可吸附的侧边 */
export type OrbEdge = 'left' | 'right';

/** 边缘吸附：球「中心」距左右屏边小于该阈值时，判定为吸附到该侧边 */
export const ORB_SNAP_THRESHOLD = 90;
/** 半隐藏停靠时，窗口压在屏幕边线上的比例（0.5 = 露出一半悬浮球） */
export const ORB_DOCK_REVEAL = 0.5;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 当前屏幕可用工作区域（剔除任务栏，逻辑像素） */
export function getScreenEdges(): { left: number; top: number; right: number; bottom: number } {
  const s = window.screen as Screen & {
    availLeft?: number;
    availTop?: number;
    availWidth?: number;
    availHeight?: number;
  };
  const left = s.availLeft ?? 0;
  const top = s.availTop ?? 0;
  const right = left + (s.availWidth ?? 1920);
  const bottom = top + (s.availHeight ?? 1080);
  return { left, top, right, bottom };
}

/** 判断逻辑像素坐标是否落在当前屏幕可用区域内（含自身尺寸） */
export function isOnScreen(
  x: number,
  y: number,
  w = ORB_COLLAPSED_W,
  h = ORB_COLLAPSED_H,
): boolean {
  const { left, top, right, bottom } = getScreenEdges();
  return x >= left && y >= top && x + w <= right && y + h <= bottom;
}

/**
 * 判断悬浮球当前应吸附到哪一侧边（仅左右）。返回 'left' | 'right' | null。
 * 取球中心更靠近、且距离小于阈值的那一侧。
 */
export function snapOrbToEdge(x: number, w: number): OrbEdge | null {
  const { left, right } = getScreenEdges();
  const center = x + w / 2;
  const leftDist = center - left;
  const rightDist = right - center;
  if (leftDist < ORB_SNAP_THRESHOLD && leftDist <= rightDist) return 'left';
  if (rightDist < ORB_SNAP_THRESHOLD) return 'right';
  return null;
}

/**
 * 计算「停靠在侧边」时的窗口位置：
 * - popped=false → 半隐藏（窗口中心压在屏幕边线上，只露出一半悬浮球）
 * - popped=true  → 完整露出（窗口贴着屏幕边，整颗悬浮球可见，但仍贴边）
 * y 会被夹紧到屏幕可用区域内，保证停靠点不会跑到屏幕外。
 */
export function orbDockedPosition(
  edge: OrbEdge,
  popped: boolean,
  w: number,
  h: number,
  y: number,
): { x: number; y: number } {
  const { left, top, right, bottom } = getScreenEdges();
  const cy = Math.min(Math.max(y, top), Math.max(top, bottom - h));
  if (edge === 'right') {
    return { x: popped ? right - w : right - w * ORB_DOCK_REVEAL, y: cy };
  }
  return { x: popped ? left : left - w * ORB_DOCK_REVEAL, y: cy };
}

/**
 * 计算悬浮球「贴近角色（主窗）」的默认位置（无碰撞、仅作为重置/落点参考）。
 * 优先角色右下方 → 左下方 → 正右 → 正下，全部越界则退回屏幕右下角。
 */
export async function computeOrbDefaultPos(
  main?: { x: number; y: number; w: number; h: number } | null,
  orbW = ORB_COLLAPSED_W,
  orbH = ORB_COLLAPSED_H,
): Promise<{ x: number; y: number }> {
  const { left, top, right, bottom } = getScreenEdges();
  if (main) {
    const candidates: { x: number; y: number }[] = [
      { x: main.x + main.w + ORB_GAP, y: main.y + main.h - orbH }, // 角色右下方
      { x: main.x - orbW - ORB_GAP, y: main.y + main.h - orbH }, // 角色左下方
      { x: main.x + main.w + ORB_GAP, y: main.y }, // 角色正右
      { x: main.x + (main.w - orbW) / 2, y: main.y + main.h + ORB_GAP }, // 角色正下
    ];
    for (const c of candidates) {
      if (c.x >= left && c.y >= top && c.x + orbW <= right && c.y + orbH <= bottom) return c;
    }
  }
  // 兜底：屏幕右下角
  return { x: right - orbW - 40, y: bottom - orbH - 40 };
}

/** 读取已保存位置；无效（越界 / 格式错 / 缺失）则返回 null */
export function loadSavedOrbPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(ORB_POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.x === 'number' && typeof p?.y === 'number' && isOnScreen(p.x, p.y)) {
      return { x: p.x, y: p.y };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** 读取主窗（角色）的矩形（逻辑像素）。找不到主窗时返回 null */
export async function getMainRect(): Promise<Rect | null> {
  const dpr = window.devicePixelRatio || 1;
  try {
    const main = await WebviewWindow.getByLabel('main').catch(() => null);
    if (!main) return null;
    const [p, s] = await Promise.all([
      main.outerPosition().catch(() => null),
      main.outerSize().catch(() => null),
    ]);
    if (!p || !s) return null;
    return { x: p.x / dpr, y: p.y / dpr, w: s.width / dpr, h: s.height / dpr };
  } catch {
    return null;
  }
}

/** 把窗口矩形 clamp 到屏幕可用区域内，保证展开面板等不被截断。 */
export function clampToScreen(
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number } {
  const { left, top, right, bottom } = getScreenEdges();
  return {
    x: Math.min(Math.max(x, left), Math.max(left, right - w)),
    y: Math.min(Math.max(y, top), Math.max(top, bottom - h)),
  };
}

