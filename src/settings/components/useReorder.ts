import { useRef, useState, useMemo, useCallback, useEffect, useLayoutEffect } from 'react';

const MOVE_THRESHOLD = 5; // px，超过该位移才判定为拖拽

interface UseReorderOptions {
  /** 排序完成时回调，传入新的 id 顺序 */
  onReorder: (orderedIds: string[]) => void;
  /** 未移动（即单击）时回调，用于选中方案 */
  onSelect?: (id: string) => void;
}

/**
 * 列表拖拽排序 hook（Pointer Events + document 级监听 + FLIP 挤压动画）
 *
 * 交互类似 iOS/Android 桌面图标排序：
 * - 按住卡片，超过阈值后进入拖拽：卡片浮起并跟随指针（fixed 浮层）
 * - 原位置显示占位框，其余卡片依据 visualItems 实时、平滑地被挤开（FLIP transform 动画）
 * - 松开时卡片落入占位位置，触发 onReorder
 * - 只是单击（未移动）则触发 onSelect，不影响选中方案
 *
 * 关键：
 * 1. pointermove / pointerup 挂在 document 上，即便被拖卡片被替换成占位框也不会丢失事件；
 * 2. 视觉顺序重排（DOM 顺序变化）本身无动画，靠 FLIP（First-Last-Invert-Play）把"瞬移"变成平滑滑动。
 */
export function useReorder<T extends { id: string }>(items: T[], options: UseReorderOptions) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [insertIndex, setInsertIndex] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragSize, setDragSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const prevTops = useRef<Map<string, number>>(new Map());

  const stateRef = useRef({
    id: null as string | null,
    startX: 0,
    startY: 0,
    moved: false,
    container: null as HTMLElement | null,
    rects: [] as { id: string; top: number; bottom: number }[],
    itemLeft: 0,
    itemTop: 0,
    itemWidth: 0,
    itemHeight: 0,
    insertIndex: 0,
  }).current;

  // 始终持有最新数据，避免 document 监听器闭包读到旧值
  const itemsRef = useRef(items);
  const optsRef = useRef(options);
  useEffect(() => {
    itemsRef.current = items;
    optsRef.current = options;
  });

  const refreshRects = useCallback(() => {
    if (!stateRef.container) return;
    stateRef.rects = Array.from(stateRef.container.querySelectorAll('[data-reorder-item]')).map(
      (el) => {
        const rect = el.getBoundingClientRect();
        return {
          id: (el as HTMLElement).dataset.reorderItem!,
          top: rect.top,
          bottom: rect.bottom,
        };
      },
    );
  }, [stateRef]);

  const computeInsertIndex = useCallback(
    (dragCenterY: number): number => {
      const others = stateRef.rects.filter((r) => r.id !== stateRef.id);
      let index = others.length;
      for (let i = 0; i < others.length; i++) {
        const r = others[i];
        const center = (r.top + r.bottom) / 2;
        // 以被拖拽卡片的中心判断：越过目标卡片中心线即视为「覆盖超过一半」
        if (dragCenterY < center) {
          index = i;
          break;
        }
      }
      return index;
    },
    [stateRef],
  );

  const resetState = useCallback(() => {
    stateRef.id = null;
    stateRef.moved = false;
    stateRef.container = null;
    stateRef.rects = [];
    stateRef.insertIndex = 0;
    setDraggingId(null);
    setInsertIndex(null);
  }, [stateRef]);

  const handlePointerDown = useCallback(
    (id: string) => (e: React.PointerEvent) => {
      // 只响应主按钮
      if (e.button !== 0) return;
      // 点中按钮/输入框等交互元素时不启动排序拖拽
      const target = e.target as HTMLElement;
      if (target.closest('button, input, select, textarea, a, [role="button"]')) return;

      const el = e.currentTarget as HTMLElement;
      const rect = el.getBoundingClientRect();
      stateRef.id = id;
      stateRef.startX = e.clientX;
      stateRef.startY = e.clientY;
      stateRef.moved = false;
      stateRef.container = el.parentElement;
      stateRef.itemLeft = rect.left;
      stateRef.itemTop = rect.top;
      stateRef.itemWidth = rect.width;
      stateRef.itemHeight = rect.height;
      stateRef.insertIndex = 0;
      refreshRects();

      setDragPos({ x: rect.left, y: rect.top });
      setDragSize({ width: rect.width, height: rect.height });

      const onMove = (ev: PointerEvent) => {
        if (stateRef.id === null) return;
        const dx = Math.abs(ev.clientX - stateRef.startX);
        const dy = Math.abs(ev.clientY - stateRef.startY);
        if (!stateRef.moved && (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD)) {
          stateRef.moved = true;
          const idx = itemsRef.current.findIndex((i) => i.id === stateRef.id);
          stateRef.insertIndex = idx >= 0 ? idx : 0;
          setInsertIndex(stateRef.insertIndex);
          setDraggingId(stateRef.id);
        }
        if (stateRef.moved) {
          // 实时刷新布局，用当前各卡片位置计算插入点
          refreshRects();
          const currentY = stateRef.itemTop + (ev.clientY - stateRef.startY);
          setDragPos({
            x: stateRef.itemLeft + (ev.clientX - stateRef.startX),
            y: currentY,
          });
          // 用被拖拽卡片的中心判断落点，而不是鼠标位置，这样「卡片覆盖一半」就触发挤压
          const dragCenterY = currentY + stateRef.itemHeight / 2;
          const newIndex = computeInsertIndex(dragCenterY);
          if (newIndex !== stateRef.insertIndex) {
            stateRef.insertIndex = newIndex;
            setInsertIndex(newIndex);
          }
        }
      };

      const cleanup = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onCancel);
      };

      const onUp = () => {
        cleanup();
        const fromId = stateRef.id;
        const moved = stateRef.moved;
        const k = stateRef.insertIndex;
        resetState();

        if (!fromId) return;
        if (moved) {
          // k 是「在去掉被拖项后的列表」里的插入位置；其余项整体让位
          const ids = itemsRef.current.map((i) => i.id);
          const rest = ids.filter((id) => id !== fromId);
          const insert = Math.max(0, Math.min(k, rest.length));
          const finalIds = [...rest.slice(0, insert), fromId, ...rest.slice(insert)];
          optsRef.current.onReorder(finalIds);
        } else {
          optsRef.current.onSelect?.(fromId);
        }
      };

      const onCancel = () => {
        cleanup();
        resetState();
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onCancel);
    },
    [stateRef, refreshRects, computeInsertIndex, resetState],
  );

  const visualItems = useMemo(() => {
    if (!draggingId || insertIndex === null) return items;
    const dragged = items.find((i) => i.id === draggingId);
    if (!dragged) return items;
    // k = 在「去掉被拖项后的列表」里的插入位置，其余项整体让位（Android 桌面式挤压）
    const rest = items.filter((i) => i.id !== draggingId);
    const k = Math.max(0, Math.min(insertIndex, rest.length));
    return [...rest.slice(0, k), dragged, ...rest.slice(k)];
  }, [items, draggingId, insertIndex]);

  // FLIP：把 DOM 重排的"瞬移"变成平滑滑动，形成"被挤开"的挤压观感
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const els = Array.from(container.querySelectorAll<HTMLElement>('[data-reorder-item]'));
    if (els.length === 0) return;
    // 先清除 transform 干扰再读真实布局位置
    els.forEach((el) => {
      el.style.transition = 'none';
      el.style.transform = '';
    });
    els.forEach((el) => {
      const id = el.dataset.reorderItem!;
      const top = el.getBoundingClientRect().top;
      const prev = prevTops.current.get(id);
      if (prev !== undefined && Math.abs(prev - top) > 0.5) {
        const delta = prev - top;
        el.style.transform = `translateY(${delta}px)`;
        // 强制 reflow 后再过渡到 0，确保 Invert 生效
        void el.offsetHeight;
        el.style.transition =
          'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), border-color 200ms ease, background-color 200ms ease';
        el.style.transform = '';
      }
      prevTops.current.set(id, top);
    });
  }, [visualItems, draggingId]);

  return {
    handlePointerDown,
    draggingId,
    insertIndex,
    dragPos,
    dragSize,
    visualItems,
    containerRef,
  };
}
