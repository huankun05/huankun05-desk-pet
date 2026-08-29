import { useState, useRef, useCallback, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, LogicalPosition, LogicalSize } from '@tauri-apps/api/window';
import { emit, listen } from '@tauri-apps/api/event';
import { isTauriEnv } from '../../utils/tauriEnv';
import {
  loadOrbPos,
  saveOrbPos,
  computeOrbDefaultPos,
  getMainRect,
  ORB_COLLAPSED_W,
  ORB_COLLAPSED_H,
  ORB_EXPANDED_W,
  ORB_EXPANDED_H,
  snapOrbToEdge,
  orbDockedPosition,
  clampToScreen,
} from '../../utils/orbPosition';

export interface ControlsOrbModelOption {
  id: string;
  name: string;
  model3Json: string;
  configJson: string;
  icon: string;
}

/** 主窗 → 悬浮球 的状态快照 */
export interface ControlsStatePayload {
  petVisible: boolean;
  isLocked: boolean;
  isTransforming: boolean;
  fadeOnHover: boolean;
  currentModelId: string;
  availableModels: ControlsOrbModelOption[];
}

/** 悬浮球 → 主窗 的动作 */
export type ControlsActionType =
  'settings' | 'chat' | 'hidepet' | 'transform' | 'fade' | 'lock' | 'exit' | 'switchModel';

export interface ControlsActionPayload {
  type: ControlsActionType;
  payload?: string;
}

const buttons = [
  { icon: 'solar:settings-linear', label: 'settings' },
  { icon: 'solar:chat-round-dots-linear', label: 'chat' },
  { icon: 'solar:eye-closed-linear', label: 'hidepet' },
  { icon: 'solar:cursor-linear', label: 'transform' },
  { icon: 'solar:users-group-rounded-linear', label: 'model' },
  { icon: 'solar:eye-bold', label: 'fade' },
  { icon: 'solar:lock-keyhole-linear', label: 'lock' },
  { icon: 'solar:power-linear', label: 'exit' },
];

const BTN_SIZE = 40;
const BTN_GAP = 8;
const BTN_PER_ROW = 3;
const PANEL_PADDING = 14;
const RADIUS = 16;
const MAIN_BTN_SIZE = 48;

const COLORS = {
  bg: 'rgba(255, 255, 255, 0.96)',
  bgHover: 'rgba(248, 250, 252, 1)',
  border: 'rgba(226, 232, 240, 0.9)',
  text: 'rgba(30, 41, 59, 0.95)',
  textMuted: 'rgba(100, 116, 139, 0.7)',
  accent: '#6366f1',
  accentSoft: 'rgba(99, 102, 241, 0.2)',
  accentBg: 'rgba(99, 102, 241, 0.12)',
  accentBgHover: 'rgba(99, 102, 241, 0.2)',
  danger: '#ef4444',
  dangerSoft: 'rgba(239, 68, 68, 0.2)',
  dangerBg: 'rgba(239, 68, 68, 0.12)',
  dangerBgHover: 'rgba(239, 68, 68, 0.2)',
  shadow: '0 6px 24px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.06)',
  // 悬浮球本体阴影：极淡，轻浮起感，不显框。hover 时不再变化（仅保留放大反馈），避免冒出新边框。
  orbShadowIdle: '0 2px 10px rgba(0, 0, 0, 0.07)',
};

/**
 * 控制面板悬浮球（独立常驻窗口，label="controls"）。
 *
 * 交互模型（用户 2026-08-10 最终定调）：
 * - **窗口尺寸精确**：收起态窗口只比小圆略大（60×60），展开时才用 `setSize` 放大到面板；
 *   绝不开大窗口——否则透明区会整片捕获点击、视觉上像一圈窗框阴影。
 * - **无碰撞、z 序最高**：悬浮球永远盖在角色之上，可自由拖到角色动画上方，互不挤压。
 * - **拖拽**：系统级 `startDragging()`（丝滑、无回弹、不抖）。
 * - **侧边停靠（半隐藏）**：拖到离左右屏边足够近时自动吸附，窗口中心压在边线上，
 *   只露出半个悬浮球。
 * - **靠近弹出**：停靠态下鼠标移到露出的半个球上 → 整颗球滑出、仍贴着边（但不展开面板）。
 * - **点击才展开**：只有点击才展开控制面板（不 hover 展开）；展开位置会被 clamp 到屏幕内，
 *   保证面板绝不被裁到窗口外。点窗口外（失焦）或点面板空白 → 自动收起。
 * - 纯 CSS `pointer-events` 穿透：仅小圆/面板可交互，其余透明区点击穿透到桌面/角色。
 * - 状态由主窗经 `controls:state` 下发；动作经 `controls:action` 回传主窗执行。
 */
export default function ControlsOrb() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  // 控制小圆阴影：停靠半隐藏时隐藏（避免阴影露在窗口外形成方框）
  const [hideShadow, setHideShadow] = useState(false);
  // 聊天未读计数（懒初始化：挂载即读 localStorage，避免 effect 内 setState 反模式）
  const [unreadCount, setUnreadCount] = useState<number>(() => {
    try {
      const initVal = parseInt(localStorage.getItem('deskpet_chat_unread') || '0', 10);
      return Number.isFinite(initVal) ? Math.max(0, initVal) : 0;
    } catch {
      return 0;
    }
  });

  // 来自主窗的状态快照（初始用安全默认值，挂载后由 controls:state 填充）
  const [state, setState] = useState<ControlsStatePayload>({
    petVisible: true,
    isLocked: true,
    isTransforming: false,
    fadeOnHover: true,
    currentModelId: '',
    availableModels: [],
  });

  const expandedRef = useRef(expanded);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  // 确保悬浮球窗口不出现在 Windows 任务栏。
  // 构造期的 skipTaskbar: true 与 JS setSkipTaskbar 均走 tao 的 ITaskbarList::DeleteTab，
  // 在窗口未注册进任务栏或重新显示时存在时序失效；改用 Rust 侧 Win32 WS_EX_TOOLWINDOW
  // 方案（清除 WS_EX_APPWINDOW + 设置 TOOLWINDOW，持久生效，不随显示/激活反复）。
  useEffect(() => {
    if (!isTauriEnv()) return;
    invoke('force_hide_from_taskbar').catch(() => {
      // 命令不可用时退回 JS API（老版本兼容）
      getCurrentWindow()
        .setSkipTaskbar(true)
        .catch(() => {});
    });
  }, []);

  // 主窗状态快照（用 ref 追踪上一帧，用于检测「锁定→解锁」跳变）
  const stateRef = useRef(state);

  // 停靠状态：null=自由浮动；'left'/'right'=吸附在该侧边（半隐藏）
  const dockRef = useRef<ReturnType<typeof snapOrbToEdge>>(null);
  // 停靠态下：鼠标靠近 → 弹出整球（true）；否则半隐藏（false）
  const poppedRef = useRef(false);
  // 停靠时的垂直位置（拖到哪停在哪）
  const savedYRef = useRef(0);
  // 边缘吸附的 debounce 定时器
  const snapTimer = useRef<number | null>(null);
  // 是否正在系统级拖拽中
  const draggingRef = useRef(false);
  // 标记「程序化移动」：我们在代码里主动 setPosition（弹出/收起/吸附/展开夹紧）时置位，
  // 让 onMoved 的 debounce 跳过这些移动，避免与 hover 弹出互相打架导致反复横跳。
  const programmaticMoveRef = useRef(false);
  const programmaticTimer = useRef<number | null>(null);
  // 鼠标移开后的「延迟收起」定时器
  const leaveTimer = useRef<number | null>(null);

  /** 主动移动窗口（逻辑像素）。置位 programmaticMoveRef 一段时间，屏蔽 onMoved 的吸附逻辑回调。 */
  const moveWin = useCallback((x: number, y: number, persist = true) => {
    if (!isTauriEnv()) return;
    const win = getCurrentWindow();
    programmaticMoveRef.current = true;
    if (programmaticTimer.current) clearTimeout(programmaticTimer.current);
    programmaticTimer.current = window.setTimeout(() => {
      programmaticMoveRef.current = false;
    }, 300);
    win.setPosition(new LogicalPosition(x, y)).catch(() => {});
    if (persist) {
      void saveOrbPos(x, y);
    }
  }, []);

  /**
   * ★ Z 序保顶（唯一可靠方式 = toggle：先 off 再 on）。
   * 多 alwaysOnTop 窗口间，Windows 规则是「最近聚焦的置顶窗在最上」。
   * setAlwaysOnTop(true) 对已置顶窗口不改变同层级顺序，必须 off→on 强制重排。
   *
   * 关键防闪烁：用 150ms 节流，避免短时间内多次 toggle（off 会瞬间把窗口移出置顶层→视觉闪烁）。
   * 只在「真正需要提价」的离散事件里调用（失焦 / hover / 点击 / 解锁），绝不进定时器或主窗焦点回调。
   */
  const lastRaiseRef = useRef(0);
  const raiseOrb = useCallback(() => {
    const now = Date.now();
    if (now - lastRaiseRef.current < 150) return; // 节流，防边界快速横跳时连发
    lastRaiseRef.current = now;
    if (!isTauriEnv()) return;
    const w = getCurrentWindow();
    w.setAlwaysOnTop(false)
      .then(() => w.setAlwaysOnTop(true))
      .catch(() => {});
  }, []);

  /** 把窗口移动到「停靠态」应有的位置（半隐藏 或 弹出整球） */
  const applyDockLayout = useCallback(() => {
    if (!isTauriEnv()) return;
    if (!dockRef.current || expandedRef.current) return;
    // 半隐藏停靠时隐藏阴影，弹出整球时恢复
    setHideShadow(!poppedRef.current);
    const pos = orbDockedPosition(
      dockRef.current,
      poppedRef.current,
      ORB_COLLAPSED_W,
      ORB_COLLAPSED_H,
      savedYRef.current,
    );
    moveWin(pos.x, pos.y);
  }, [moveWin]);

  /** 鼠标移开 / 失焦后延迟收起弹出态（停靠态 + 已弹出 + 未展开面板时生效） */
  const scheduleRetract = useCallback(() => {
    if (!(dockRef.current && poppedRef.current && !expandedRef.current)) return;
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => {
      poppedRef.current = false;
      applyDockLayout();
      leaveTimer.current = null;
    }, 400);
  }, [applyDockLayout]);

  // ── 挂载初始化：透明背景 + 位置恢复 + 事件接线 + Z 序保顶 ──
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.style.backgroundColor = 'transparent';
      document.body.style.margin = '0';
      document.body.style.overflow = 'hidden';
      // 整个 body 点击穿透：窗口内除小圆/面板（pointer-events:auto）外的所有区域都不拦截，
      // 这样窗口周围的桌面/角色都能正常点击，不会被这个悬浮球窗口捕获。
      document.body.style.pointerEvents = 'none';
      // html 元素也必须透明（Windows DWM 透明窗口要求）
      document.documentElement.style.backgroundColor = 'transparent';
    }
    if (!isTauriEnv()) return;

    const win = getCurrentWindow();

    // ═══════════════════════════════════════════
    // ★ Z 序保顶（2026-08-10 20:11 修正版）
    //
    // 问题本质（死锁）：
    //   main 与 controls 都是 alwaysOnTop。Windows 规则 = 最近焦点置顶窗在最上。
    //   controls 创建时 focus:false → z 序低于 main → 鼠标进不了 controls 按钮。
    //
    // 上版错误：setInterval(300ms) 做 false→true toggle → 窯口每秒闪烁 3+ 次！
    //
    // 正确方案（纯事件驱动，零周期性切换）：
    //   ① 创建时立即 toggle 一次（确立初始 z-order）
    //   ② 交互时（hover/click）toggle（即时响应，确保点得到）
    //   ③ 主窗 onFocusChanged 时 re-raise（MainPetApp.tsx 已有逻辑兜底）
    //   不设定时器 —— 避免 OS 调度导致的任何周期性闪烁。
    // ═══════════════════════════════════════════

    // ① 创建时 toggle 一次
    win
      .setAlwaysOnTop(false)
      .then(() => win.setAlwaysOnTop(true))
      .catch(() => {});

    // 位置恢复：优先用保存的屏幕坐标；若越界（早期调试残留无效坐标）则回退到「贴角色」默认位。
    // 若保存位置本就贴着某侧边，则恢复为停靠态（这样 hover 能弹出、展开不裁剪）。
    const restorePos = async () => {
      try {
        let x: number;
        let y: number;
        const saved = await loadOrbPos();
        if (saved) {
          x = saved.x;
          y = saved.y;
        } else {
          const main = await getMainRect();
          const d = await computeOrbDefaultPos(main);
          x = d.x;
          y = d.y;
        }
        await win.setPosition(new LogicalPosition(x, y)).catch(() => {});
        savedYRef.current = y;
        const edge = snapOrbToEdge(x, ORB_COLLAPSED_W);
        if (edge) {
          // ★ 恢复的位置本就贴边 → 直接应用「半隐藏停靠」布局（隐藏阴影、贴合边线），
          //   否则要等用户碰一下才会吸附。
          dockRef.current = edge;
          applyDockLayout();
        } else {
          dockRef.current = null;
          setHideShadow(false);
        }
        void saveOrbPos(x, y);
      } catch {
        /* ignore */
      }
    };
    restorePos();

    // 窗口位置变化：实时持久化 + 松手后（静止 220ms）决定停靠 / 自由 / 防出屏。
    const unlistenMoved = win
      .onMoved((e) => {
        try {
          const dpr = window.devicePixelRatio || 1;
          const x = e.payload.x / dpr;
          const y = e.payload.y / dpr;
          savedYRef.current = y;
          void saveOrbPos(x, y);
          // debounce：拖拽中持续触发，松手静止后才处理一次（避免拖拽途中抖动）
          if (snapTimer.current) clearTimeout(snapTimer.current);
          snapTimer.current = window.setTimeout(() => {
            // 程序化移动（弹出/收起/展开夹紧）不触发吸附逻辑，避免与 hover 弹出互相打架
            if (programmaticMoveRef.current) return;
            const w = expandedRef.current ? ORB_EXPANDED_W : ORB_COLLAPSED_W;
            const h = expandedRef.current ? ORB_EXPANDED_H : ORB_COLLAPSED_H;
            // 展开态：不吸附，仅保证面板不出屏
            if (expandedRef.current) {
              const fixed = clampToScreen(x, y, w, h);
              if (fixed.x !== x || fixed.y !== y) {
                moveWin(fixed.x, fixed.y);
              }
              return;
            }
            const edge = snapOrbToEdge(x, w);
            if (edge) {
              // 吸附成「半隐藏停靠」
              dockRef.current = edge;
              poppedRef.current = false;
              applyDockLayout();
            } else {
              // 自由浮动：清除停靠，仅确保不出屏
              dockRef.current = null;
              setHideShadow(false); // 自由浮动时恢复阴影
              const fixed = clampToScreen(x, y, w, h);
              if (fixed.x !== x || fixed.y !== y) {
                moveWin(fixed.x, fixed.y);
              }
            }
          }, 220);
        } catch {
          /* ignore */
        }
      })
      .then((u) => u)
      .catch(() => null);

    // 窗口失焦（点击窗口外/桌面/角色）→ 自动收起面板，并延迟收起停靠弹出态。
    // 同时自我提价：失去焦点那刻把球 re-raise 回角色之上（避免主窗抢走 z 序后球被盖住）。
    // 注意：只在此「失焦」离散事件里提价，不进主窗焦点回调 —— 否则两窗焦点互抢会死循环闪烁。
    const unlistenFocus = win
      .onFocusChanged(({ payload: focused }) => {
        if (!focused) {
          setExpanded(false);
          scheduleRetract();
          raiseOrb();
        }
      })
      .then((u) => u)
      .catch(() => null);

    // 接收主窗状态快照
    const unlistenState = listen<ControlsStatePayload>('controls:state', (e) => {
      const prevLocked = stateRef.current.isLocked;
      setState(e.payload);
      stateRef.current = e.payload;
      if (prevLocked && !e.payload.isLocked) {
        raiseOrb();
      }
    }).catch(() => null);

    // 监听聊天未读计数（localStorage 跨窗口同步）
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'deskpet_chat_unread') {
        const val = parseInt(e.newValue || '0', 10);
        setUnreadCount(Number.isFinite(val) ? Math.max(0, val) : 0);
      }
    };
    window.addEventListener('storage', onStorage);
    // 初始化已并入 useState 懒初始化（localStorage 读取），此处不再重复 setState

    return () => {
      unlistenMoved?.then((u) => u?.());
      unlistenFocus?.then((u) => u?.());
      unlistenState?.then((u) => u?.());
      if (snapTimer.current) clearTimeout(snapTimer.current);
      if (programmaticTimer.current) clearTimeout(programmaticTimer.current);
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      window.removeEventListener('storage', onStorage);
    };
  }, [applyDockLayout, scheduleRetract, raiseOrb, moveWin]);

  // ── 展开/收起时动态调整窗口尺寸（收起=小圆，展开=面板）──
  // 关键：窗口尺寸紧贴可见内容，避免大窗口捕获周围点击；展开后若超出屏幕则 clamp 防裁剪。
  useEffect(() => {
    expandedRef.current = expanded;
    if (!isTauriEnv()) return;
    const win = getCurrentWindow();
    const w = expanded ? ORB_EXPANDED_W : ORB_COLLAPSED_W;
    const h = expanded ? ORB_EXPANDED_H : ORB_COLLAPSED_H;
    win.setSize(new LogicalSize(w, h)).catch(() => {});
    if (expanded) {
      // 展开后若超出屏幕，clamp 窗口位置保证面板完整可见（不被截断）
      win
        .outerPosition()
        .then((p) => {
          const dpr = window.devicePixelRatio || 1;
          const cur = { x: p.x / dpr, y: p.y / dpr };
          const fixed = clampToScreen(cur.x, cur.y, w, h);
          if (fixed.x !== cur.x || fixed.y !== cur.y) {
            moveWin(fixed.x, fixed.y);
          }
        })
        .catch(() => {});
    } else if (dockRef.current) {
      // 收起：回到停靠态（半隐藏）
      poppedRef.current = false;
      applyDockLayout();
    } else {
      // 收起且自由浮动：确保不出屏
      win
        .outerPosition()
        .then((p) => {
          const dpr = window.devicePixelRatio || 1;
          const cur = { x: p.x / dpr, y: p.y / dpr };
          const fixed = clampToScreen(cur.x, cur.y, w, h);
          if (fixed.x !== cur.x || fixed.y !== cur.y) {
            moveWin(fixed.x, fixed.y);
          }
        })
        .catch(() => {});
    }
  }, [expanded, applyDockLayout, moveWin]);

  // ── 拖动悬浮球/抓手：系统级拖拽（最丝滑、无回弹）。无碰撞，可自由盖在角色上。 ──
  const beginDrag = useCallback((e: React.MouseEvent) => {
    if (!isTauriEnv()) return;
    e.preventDefault();
    e.stopPropagation();
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    let started = false;
    draggingRef.current = false;
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    const move = (ev: MouseEvent) => {
      // 小于 3px 视为点击，不触发拖动
      if (!started && Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY) > 3) {
        started = true;
        draggingRef.current = true;
        poppedRef.current = false;
        try {
          // 系统级拖动：OS 直接跟随鼠标，最简单可靠、绝不抖。松手后由 onMoved 做边缘吸附。
          getCurrentWindow().startDragging();
        } catch {
          /* ignore */
        }
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      }
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      draggingRef.current = false;
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, []);

  // ── 小圆交互：靠近弹出 / 延迟收起 / 点击展开 ──
  // 停靠态下鼠标移到露出的半个球上 → 弹出整球（仍贴边，但不展开面板）；并重新置顶到角色之上。
  const handleOrbEnter = () => {
    // 取消可能存在的延迟收起
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    if (dockRef.current && !expandedRef.current) {
      poppedRef.current = true;
      setHideShadow(false); // 弹出整球时恢复阴影
      applyDockLayout();
    }
    // ★ Z 序保顶：hover 靠近时把球提到角色之上（节流，防快速横跳连发）
    raiseOrb();
  };
  // 停靠态下鼠标移开 → 延迟（400ms）退回半隐藏（除非已展开面板 / 期间又移回）
  const handleOrbLeave = () => {
    scheduleRetract();
  };
  // 点击：展开面板（已是展开则收起）。停靠态先弹出整球再展开，避免面板被边裁切。
  const handleOrbClick = () => {
    // ★ Z 序保顶：点击时把球提到角色之上（节流），确保点击被 controls 捕获而非被 main 抢走
    raiseOrb();
    if (expandedRef.current) {
      setExpanded(false);
      return;
    }
    if (dockRef.current) {
      poppedRef.current = true;
      applyDockLayout();
    }
    setExpanded(true);
  };

  const handleBtnClick = (label: string, ev?: React.MouseEvent) => {
    ev?.stopPropagation();
    // “模型”按钮仅切换本地模型选择器展开，不向主窗发动作
    if (label === 'model') {
      setShowModelPicker((v) => !v);
      return;
    }
    const map: Record<string, ControlsActionType> = {
      settings: 'settings',
      chat: 'chat',
      hidepet: 'hidepet',
      transform: 'transform',
      fade: 'fade',
      lock: 'lock',
      exit: 'exit',
    };
    const action = map[label];
    if (!action) return;
    console.log('[ControlsOrb] emit controls:action ->', action);
    emit('controls:action', { type: action } satisfies ControlsActionPayload).catch(() => {});
  };

  const activeMap: Record<string, boolean> = {
    transform: state.isTransforming,
    model: showModelPicker,
    fade: state.fadeOnHover,
    lock: state.isLocked,
    hidepet: !state.petVisible,
  };

  const btnList = buttons.map((b) => ({
    ...b,
    icon:
      b.label === 'hidepet'
        ? state.petVisible
          ? 'solar:eye-closed-linear'
          : 'solar:ghost-linear'
        : b.label === 'fade'
          ? state.fadeOnHover
            ? 'solar:eye-bold'
            : 'solar:eye-closed-linear'
        : b.label === 'lock'
          ? state.isLocked
            ? 'solar:lock-keyhole-linear'
            : 'solar:lock-keyhole-unlocked-linear'
          : b.icon,
  }));

  const modelPicker = showModelPicker &&
    state.availableModels &&
    state.availableModels.length > 0 && (
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: '10px',
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
          background: COLORS.bg,
          minWidth: 140,
          boxShadow: COLORS.shadow,
        }}
      >
        {state.availableModels.map((m) => (
          <button
            key={m.id}
            onClick={(e) => {
              e.stopPropagation();
              emit('controls:action', {
                type: 'switchModel',
                payload: m.id,
              } satisfies ControlsActionPayload).catch(() => {});
              setShowModelPicker(false);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 14px',
              border:
                m.id === state.currentModelId
                  ? `1.5px solid ${COLORS.accentSoft}`
                  : '1px solid transparent',
              borderRadius: 10,
              background: m.id === state.currentModelId ? COLORS.accentBg : 'transparent',
              color: m.id === state.currentModelId ? COLORS.accent : COLORS.text,
              cursor: 'pointer',
              fontSize: 13,
              whiteSpace: 'nowrap',
              transition: 'all 150ms ease',
              fontWeight: m.id === state.currentModelId ? 500 : 400,
            }}
            onMouseEnter={(e) => {
              if (m.id !== state.currentModelId)
                e.currentTarget.style.background = 'rgba(241, 245, 249, 1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background =
                m.id === state.currentModelId ? COLORS.accentBg : 'transparent';
            }}
          >
            {m.icon ? (
              <img
                src={m.icon}
                alt={m.name}
                style={{ width: 22, height: 22, borderRadius: 6, objectFit: 'cover' }}
              />
            ) : (
              <Icon icon="solar:user-rounded-linear" width={20} height={20} />
            )}
            {m.name}
            {m.id === state.currentModelId && (
              <Icon
                icon="solar:check-circle-linear"
                width={16}
                height={16}
                style={{ marginLeft: 'auto', color: COLORS.accent }}
              />
            )}
          </button>
        ))}
      </div>
    );

  const grip = (
    <div
      onMouseDown={beginDrag}
      title={t('controls.drag_to_move')}
      style={{
        width: '100%',
        height: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'grab',
        touchAction: 'none',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 30,
          height: 4,
          borderRadius: 2,
          background: 'rgba(148, 163, 184, 0.55)',
        }}
      />
    </div>
  );

  return (
    <div
      className="orb-root"
      onMouseLeave={handleOrbLeave}
      style={{
        position: 'fixed',
        top: 6,
        left: 6,
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 8,
        // 容器整体不拦截鼠标；仅悬浮球/面板内部元素可交互（配合窗口级点击穿透）
        pointerEvents: 'none',
      }}
    >
      {/* 展开态：全窗口透明 backdrop（pointer-events:auto）拦截点击，用于「点周围关门」，
          避免点击面板窗口内的留白时漏给下方角色（主窗 body 穿透导致）。
          点击真正的面板/小圆（DOM 中在其后，层级更高）不受影响。 */}
      {expanded && (
        <div
          onClick={() => setExpanded(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'transparent',
            pointerEvents: 'auto',
            zIndex: 0,
          }}
        />
      )}
      {/* 小圆（入口）：靠近→弹出整球；点击→展开面板；按下拖动→移动窗口 */}
      <button
        onMouseDown={(e) => {
          beginDrag(e);
          e.currentTarget.style.transform = 'scale(0.92)';
        }}
        onMouseEnter={() => {
          handleOrbEnter();
        }}
        onMouseUp={(e) => {
          e.currentTarget.style.transform = 'scale(1)';
        }}
        onClick={handleOrbClick}
        title={t('controls.expand')}
        style={{
          width: MAIN_BTN_SIZE,
          height: MAIN_BTN_SIZE,
          // ★ 方案A：去掉硬边框（白底下灰色 1px 边框把方形阴影框得显脏），只留柔和阴影。
          //   半隐藏停靠时仍隐藏阴影（避免露窗口外形成方框）。
          border: 'none',
          borderRadius: '50%',
          background: state.isLocked ? COLORS.dangerBg : COLORS.bg,
          color: state.isLocked ? COLORS.danger : COLORS.text,
          cursor: 'grab',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // 极淡柔和阴影（仅轻浮起感，不显框）；半隐藏停靠时隐藏
          boxShadow: hideShadow ? 'none' : COLORS.orbShadowIdle,
          pointerEvents: 'auto',
          position: 'relative',
          zIndex: 2,
          transition: 'transform 90ms ease-out',
          // ★ 去除原生 <button> 外观与聚焦框：否则 hover/聚焦时浏览器会描出方形轮廓（"方框"）
          outline: 'none',
          WebkitAppearance: 'none',
          MozAppearance: 'none',
          appearance: 'none',
        }}
        onMouseLeave={(e) => {
          handleOrbLeave();
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.boxShadow = hideShadow ? 'none' : COLORS.orbShadowIdle;
        }}
      >
        <Icon
          icon={state.isLocked ? 'solar:lock-keyhole-linear' : 'solar:widget-4-linear'}
          width={22}
          height={22}
        />
      </button>

      {expanded && (
        <div
          onClick={(e) => {
            // 点击面板自身的空白区域（非按钮/子元素）→ 收起
            if (e.target === e.currentTarget) setExpanded(false);
          }}
          style={{
            position: 'relative',
            zIndex: 2,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            padding: PANEL_PADDING,
            background: COLORS.bg,
            backdropFilter: 'blur(12px)',
            border: `1px solid ${COLORS.border}`,
            borderRadius: RADIUS,
            boxShadow: COLORS.shadow,
            pointerEvents: 'auto',
            animation: 'fadeInUp 200ms ease-out',
          }}
        >
          {grip}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${BTN_PER_ROW}, ${BTN_SIZE}px)`,
              gap: BTN_GAP,
            }}
          >
            {btnList.map((b) => {
              const active = activeMap[b.label] ?? false;
              const isLockBtn = b.label === 'lock';
              const isDangerActive = isLockBtn && state.isLocked;
              return (
                <button
                  key={b.label}
                  onClick={(e) => handleBtnClick(b.label, e)}
                  title={t(`controls.${b.label}`)}
                  style={{
                    width: BTN_SIZE,
                    height: BTN_SIZE,
                    border: isDangerActive
                      ? `1.5px solid ${COLORS.dangerSoft}`
                      : active
                        ? `1.5px solid ${COLORS.accentSoft}`
                        : `1px solid ${COLORS.border}`,
                    borderRadius: 12,
                    background: isDangerActive
                      ? COLORS.dangerBg
                      : active
                        ? COLORS.accentBg
                        : 'rgba(248, 250, 252, 0.8)',
                    color: isDangerActive ? COLORS.danger : active ? COLORS.accent : COLORS.text,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 150ms ease',
                    boxShadow: active
                      ? isDangerActive
                        ? '0 2px 8px rgba(239, 68, 68, 0.2)'
                        : '0 2px 8px rgba(99, 102, 241, 0.2)'
                      : '0 1px 3px rgba(0, 0, 0, 0.05)',
                    position: 'relative',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = isDangerActive
                      ? COLORS.dangerBgHover
                      : active
                        ? COLORS.accentBgHover
                        : 'rgba(241, 245, 249, 1)';
                    e.currentTarget.style.transform = 'scale(1.05)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = isDangerActive
                      ? COLORS.dangerBg
                      : active
                        ? COLORS.accentBg
                        : 'rgba(248, 250, 252, 0.8)';
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                >
                  <Icon icon={b.icon} width={20} height={20} />
                  {b.label === 'chat' && unreadCount > 0 && (
                    <span
                      style={{
                        position: 'absolute',
                        top: -4,
                        right: -4,
                        minWidth: 18,
                        height: 18,
                        padding: '0 5px',
                        borderRadius: 9,
                        background: COLORS.danger,
                        color: '#fff',
                        fontSize: 11,
                        fontWeight: 600,
                        lineHeight: '18px',
                        textAlign: 'center',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                        pointerEvents: 'none',
                      }}
                    >
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {modelPicker}
        </div>
      )}
    </div>
  );
}
