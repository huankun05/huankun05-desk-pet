import { useState, useRef, forwardRef, useImperativeHandle, useCallback, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { useTranslation } from 'react-i18next';
import { isTauriEnv } from '../../utils/tauriEnv';

export interface ControlsIslandHandle {
  show: () => void;
}

/** 控制面板自由定位偏移的 localStorage key（{x,y} 相对窗口左上角 px；存在即启用自由定位） */
const CONTROLS_POS_KEY = 'deskpet_controls_pos';

export interface ModelOption {
  id: string;
  name: string;
  model3Json: string;
  configJson: string;
  icon: string;
}

interface ControlsIslandProps {
  onSettings: () => void;
  onChat: () => void;
  onToggleLive2D: () => void;
  onToggleLock: () => void;
  onToggleFade: () => void;
  onToggleTransform: () => void;
  onToggleMode: () => void;
  onExit: () => void;
  isTransforming: boolean;
  currentMode: 'chat' | 'work';
  isLocked: boolean;
  fadeOnHover: boolean;
  /** 当前 Live2D 角色是否可见（驱动隐藏按钮的高亮与图标） */
  petVisible: boolean;
  availableModels?: ModelOption[];
  currentModelId?: string;
  onSwitchModel?: (id: string) => void;
  edge?: 'left' | 'right' | 'none';
}

const buttons = [
  { icon: 'solar:settings-linear', label: 'settings' },
  { icon: 'solar:chat-round-dots-linear', label: 'chat' },
  { icon: 'solar:eye-closed-linear', label: 'hidepet' },
  { icon: 'solar:cursor-linear', label: 'transform' },
  { icon: 'solar:code-linear', label: 'mode' },
  { icon: 'solar:users-group-rounded-linear', label: 'model' },
  { icon: 'solar:eye-bold', label: 'fade' },
  { icon: 'solar:lock-keyhole-linear', label: 'lock' },
  { icon: 'solar:power-linear', label: 'exit' },
];

const BTN_SIZE = 40;
const BTN_GAP = 8;
const BTN_PER_ROW = 3;
const PANEL_PADDING = 14;
const PANEL_INNER_W = BTN_PER_ROW * BTN_SIZE + (BTN_PER_ROW - 1) * BTN_GAP;
const PANEL_W = PANEL_INNER_W + PANEL_PADDING * 2;
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
};

function ButtonGrid({
  buttons: btns,
  onBtnClick,
  isLocked = false,
}: {
  buttons: typeof buttons;
  onBtnClick: ((label: string) => void) & { activeMap?: Record<string, boolean> };
  isLocked?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${BTN_PER_ROW}, ${BTN_SIZE}px)`,
        gap: BTN_GAP,
      }}
    >
      {btns.map((b) => {
        const active = onBtnClick.activeMap?.[b.label] ?? false;
        const isLockBtn = b.label === 'lock';
        const isDangerActive = isLockBtn && isLocked;

        return (
          <button
            key={b.label}
            onClick={() => onBtnClick(b.label)}
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
          </button>
        );
      })}
    </div>
  );
}

export const ControlsIsland = forwardRef<ControlsIslandHandle, ControlsIslandProps>(
  function ControlsIsland(props, ref) {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    const [showModelPicker, setShowModelPicker] = useState(false);
    // 控制面板自由定位：相对窗口左上角的偏移（px）。为 null 时使用默认锚定布局（edge/floating）。
    const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
      try {
        const raw = localStorage.getItem(CONTROLS_POS_KEY);
        if (!raw) return null;
        const p = JSON.parse(raw);
        if (typeof p?.x === 'number' && typeof p?.y === 'number') return p;
      } catch {
        /* ignore */
      }
      return null;
    });
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dragStateRef = useRef<{
      started: boolean;
      moved: boolean;
      startX: number;
      startY: number;
      cleanup: (() => void) | null;
    }>({
      started: false,
      moved: false,
      startX: 0,
      startY: 0,
      cleanup: null,
    });

    const edge = props.edge ?? 'none';
    const isRight = edge === 'right';
    const isFloating = edge === 'none';

    const SNAP_LEAK = 28;
    const POP_DISTANCE = 8;

    const show = useCallback(() => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    }, []);

    const scheduleHide = useCallback(() => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        setExpanded(false);
        setShowModelPicker(false);
      }, 600);
    }, []);

    useEffect(
      () => () => {
        if (hideTimer.current) clearTimeout(hideTimer.current);
      },
      [],
    );

    // 自由拖动控制面板：更新相对窗口的偏移并落盘 localStorage。
    // 拖动窗口（拖宠物）时面板随窗口整体移动（面板在窗口 DOM 内），此处只负责单独摆放面板。
    const beginPanelDrag = useCallback(
      (e: React.MouseEvent) => {
        if (!isTauriEnv()) return;
        e.preventDefault();
        e.stopPropagation();

        const container = (e.currentTarget as HTMLElement).closest(
          '.controls-island',
        ) as HTMLElement | null;
        const rect = container ? container.getBoundingClientRect() : null;
        const startX = e.clientX;
        const startY = e.clientY;
        // 起始基准：已有自由偏移则用偏移，否则用当前 DOM 实际位置（兼容从默认布局首次拖出）
        const baseX =
          pos?.x ?? (rect ? rect.left : window.innerWidth / 2 - PANEL_W / 2);
        const baseY = pos?.y ?? (rect ? rect.top : window.innerHeight - 160);

        dragStateRef.current = {
          ...dragStateRef.current,
          started: true,
          moved: false,
          startX,
          startY,
          cleanup: null,
        };

        const handleMouseMove = (ev: MouseEvent) => {
          const dx = Math.abs(ev.clientX - startX);
          const dy = Math.abs(ev.clientY - startY);
          if (dx > 3 || dy > 3) {
            dragStateRef.current.moved = true;
            setPos({
              x: Math.max(0, Math.round(baseX + ev.clientX - startX)),
              y: Math.max(0, Math.round(baseY + ev.clientY - startY)),
            });
          }
        };

        const handleMouseUp = () => {
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
          if (dragStateRef.current.moved) {
            setPos((p) => {
              if (p) {
                try {
                  localStorage.setItem(CONTROLS_POS_KEY, JSON.stringify(p));
                } catch {
                  /* ignore */
                }
              }
              return p;
            });
          }
          dragStateRef.current.started = false;
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        dragStateRef.current.cleanup = () => {
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
        };
      },
      [pos],
    );

    // 主按钮：按下即进入面板拖动；若未移动则视为点击（展开/收起）。
    const handleMainBtnMouseDown = useCallback(
      (e: React.MouseEvent) => {
        if (!isTauriEnv()) return;
        beginPanelDrag(e);
      },
      [beginPanelDrag],
    );

    useEffect(() => {
      return () => {
        if (dragStateRef.current.cleanup) {
          dragStateRef.current.cleanup();
          dragStateRef.current.cleanup = null;
        }
      };
    }, []);

    const handleMainBtnClick = useCallback((e: React.MouseEvent) => {
      if (dragStateRef.current.moved) {
        e.stopPropagation();
        e.preventDefault();
        dragStateRef.current.moved = false;
        return;
      }
      setExpanded((v) => !v);
      setShowModelPicker(false);
    }, []);

    useImperativeHandle(ref, () => ({ show }), [show]);

    const handleBtnClick = (label: string) => {
      switch (label) {
        case 'settings':
          props.onSettings();
          break;
        case 'chat':
          props.onChat();
          break;
        case 'hidepet':
          props.onToggleLive2D();
          break;
        case 'transform':
          props.onToggleTransform();
          break;
        case 'mode':
          props.onToggleMode();
          break;
        case 'model':
          setShowModelPicker((v) => !v);
          break;
        case 'fade':
          props.onToggleFade();
          break;
        case 'lock':
          props.onToggleLock();
          break;
        case 'exit':
          props.onExit();
          break;
      }
    };

    const activeMap: Record<string, boolean> = {
      transform: props.isTransforming,
      mode: props.currentMode === 'work',
      model: showModelPicker,
      fade: props.fadeOnHover,
      lock: props.isLocked,
      hidepet: !props.petVisible,
    };

    const onBtnClick = Object.assign(handleBtnClick, { activeMap });

    const btnList = buttons.map((b) => ({
      ...b,
      icon:
        b.label === 'hidepet'
          ? props.petVisible
            ? 'solar:eye-closed-linear' // 角色可见：点按隐藏
            : 'solar:ghost-linear' // 角色已隐藏：点按显示
          : b.label === 'fade'
            ? props.fadeOnHover
              ? 'solar:eye-bold'
              : 'solar:eye-closed-linear'
            : b.label === 'lock'
              ? props.isLocked
                ? 'solar:lock-keyhole-linear'
                : 'solar:lock-keyhole-unlocked-linear'
              : b.label === 'mode'
                ? props.currentMode === 'work'
                  ? 'solar:code-linear'
                  : 'solar:chat-line-linear'
                : b.icon,
    }));

    const modelPicker = showModelPicker &&
      props.availableModels &&
      props.availableModels.length > 0 && (
        <div
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
          {props.availableModels.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                props.onSwitchModel?.(m.id);
                setShowModelPicker(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                border:
                  m.id === props.currentModelId
                    ? `1.5px solid ${COLORS.accentSoft}`
                    : '1px solid transparent',
                borderRadius: 10,
                background: m.id === props.currentModelId ? COLORS.accentBg : 'transparent',
                color: m.id === props.currentModelId ? COLORS.accent : COLORS.text,
                cursor: 'pointer',
                fontSize: 13,
                whiteSpace: 'nowrap',
                transition: 'all 150ms ease',
                fontWeight: m.id === props.currentModelId ? 500 : 400,
              }}
              onMouseEnter={(e) => {
                if (m.id !== props.currentModelId)
                  e.currentTarget.style.background = 'rgba(241, 245, 249, 1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background =
                  m.id === props.currentModelId ? COLORS.accentBg : 'transparent';
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
              {m.id === props.currentModelId && (
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

    // 拖动控制面板用的抓手（点击展开后可见，按住拖动即可独立摆放面板）
    const grip = (
      <div
        onMouseDown={beginPanelDrag}
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

    // ===== 自由定位模式：拖动过后按 pos 绝对定位（可单独摆放，拖窗口时随窗口移动） =====
    if (pos) {
      return (
        <div
          className="controls-island"
          style={{
            position: 'absolute',
            left: pos.x,
            top: pos.y,
            zIndex: 20,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            pointerEvents: 'none',
          }}
          onMouseEnter={show}
          onMouseLeave={scheduleHide}
        >
          {expanded && (
            <div
              style={{
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
              <ButtonGrid
                buttons={btnList}
                onBtnClick={onBtnClick}
                isLocked={props.isLocked}
              />
              {modelPicker}
            </div>
          )}

          <button
            onMouseDown={handleMainBtnMouseDown}
            onClick={handleMainBtnClick}
            title={expanded ? t('controls.collapse') : t('controls.expand')}
            style={{
              width: MAIN_BTN_SIZE,
              height: MAIN_BTN_SIZE,
              border: props.isLocked
                ? `1.5px solid ${COLORS.dangerSoft}`
                : `1px solid ${COLORS.border}`,
              borderRadius: '50%',
              background: props.isLocked ? COLORS.dangerBg : COLORS.bg,
              backdropFilter: 'blur(12px)',
              color: props.isLocked ? COLORS.danger : COLORS.text,
              cursor: 'grab',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: COLORS.shadow,
              pointerEvents: 'auto',
              transition: 'all 200ms ease',
              marginBottom: 10,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            <Icon
              icon={
                expanded
                  ? 'solar:arrow-down-linear'
                  : props.isLocked
                    ? 'solar:lock-keyhole-linear'
                    : 'solar:widget-4-linear'
              }
              width={22}
              height={22}
            />
          </button>
        </div>
      );
    }

    // ===== Floating 模式：窗口内底部居中 =====
    if (isFloating) {
      return (
        <div
          className="controls-island"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-end',
            zIndex: 20,
            pointerEvents: 'none',
          }}
          onMouseEnter={show}
          onMouseLeave={scheduleHide}
        >
          {expanded && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                padding: PANEL_PADDING,
                background: COLORS.bg,
                backdropFilter: 'blur(12px)',
                border: `1px solid ${COLORS.border}`,
                borderRadius: RADIUS,
                boxShadow: COLORS.shadow,
                pointerEvents: 'auto',
                marginBottom: 8,
                animation: 'fadeInUp 200ms ease-out',
              }}
            >
              {grip}
              <ButtonGrid buttons={btnList} onBtnClick={onBtnClick} isLocked={props.isLocked} />
              {modelPicker}
            </div>
          )}

          <button
            onMouseDown={handleMainBtnMouseDown}
            onClick={handleMainBtnClick}
            title={expanded ? t('controls.collapse') : t('controls.expand')}
            style={{
              width: MAIN_BTN_SIZE,
              height: MAIN_BTN_SIZE,
              border: props.isLocked
                ? `1.5px solid ${COLORS.dangerSoft}`
                : `1px solid ${COLORS.border}`,
              borderRadius: '50%',
              background: props.isLocked ? COLORS.dangerBg : COLORS.bg,
              backdropFilter: 'blur(12px)',
              color: props.isLocked ? COLORS.danger : COLORS.text,
              cursor: props.isTransforming ? 'grab' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: COLORS.shadow,
              pointerEvents: 'auto',
              transition: 'all 200ms ease',
              marginBottom: 10,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            <Icon
              icon={
                expanded
                  ? 'solar:arrow-down-linear'
                  : props.isLocked
                    ? 'solar:lock-keyhole-linear'
                    : 'solar:widget-4-linear'
              }
              width={22}
              height={22}
            />
          </button>
        </div>
      );
    }

    // ===== Edge 模式：贴左右边 =====
    const popTranslate = expanded ? POP_DISTANCE : 0;

    return (
      <div
        className="controls-island"
        style={{
          position: 'absolute',
          top: '50%',
          transform: `translateY(-50%) translateX(${isRight ? popTranslate : -popTranslate}px)`,
          [isRight ? 'right' : 'left']: expanded ? 0 : -(MAIN_BTN_SIZE - SNAP_LEAK),
          zIndex: 20,
          display: 'flex',
          flexDirection: isRight ? 'row-reverse' : 'row',
          alignItems: 'center',
          gap: 0,
          pointerEvents: expanded ? 'auto' : 'none',
          transition:
            'transform 300ms cubic-bezier(0.32, 0.72, 0, 1), right 300ms cubic-bezier(0.32, 0.72, 0, 1), left 300ms cubic-bezier(0.32, 0.72, 0, 1)',
        }}
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
      >
        {/* 边缘感应区 */}
        {!expanded && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              width: SNAP_LEAK + 4,
              pointerEvents: 'auto',
              cursor: 'pointer',
              ...(isRight ? { right: 0 } : { left: 0 }),
            }}
            onClick={handleMainBtnClick}
          />
        )}

        {expanded && (
          <div
            style={{
              width: PANEL_W,
              padding: PANEL_PADDING,
              background: COLORS.bg,
              backdropFilter: 'blur(12px)',
              border: `1px solid ${COLORS.border}`,
              borderRadius: RADIUS,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
              boxShadow: COLORS.shadow,
              cursor: 'default',
            }}
          >
            {grip}
            <ButtonGrid buttons={btnList} onBtnClick={onBtnClick} isLocked={props.isLocked} />
            {modelPicker}
          </div>
        )}

        {!expanded && (
          <button
            onMouseDown={handleMainBtnMouseDown}
            onClick={handleMainBtnClick}
            title={t('controls.expand')}
            style={{
              width: MAIN_BTN_SIZE,
              height: MAIN_BTN_SIZE,
              border: props.isLocked
                ? `1.5px solid ${COLORS.dangerSoft}`
                : `1px solid ${COLORS.border}`,
              borderRadius: '50%',
              background: props.isLocked ? COLORS.dangerBg : COLORS.bg,
              backdropFilter: 'blur(12px)',
              color: props.isLocked ? COLORS.danger : COLORS.text,
              cursor: props.isTransforming ? 'grab' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: COLORS.shadow,
              flexShrink: 0,
              pointerEvents: 'auto',
              transition: 'all 200ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            <Icon
              icon={props.isLocked ? 'solar:lock-keyhole-linear' : 'solar:widget-4-linear'}
              width={22}
              height={22}
            />
          </button>
        )}
      </div>
    );
  },
);
