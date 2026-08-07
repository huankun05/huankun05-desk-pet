import { useRef, useState, type DragEvent } from 'react';

/**
 * 列表拖拽排序 hook（零依赖，基于原生 HTML5 drag-and-drop）
 *
 * 用法：把返回的 handlers 挂到每个可拖拽项上，dragOverId 用于高亮落点，
 * draggingId 用于把正在拖拽的那一项做「浮起」视觉反馈。
 * 拖拽行为不会触发项的 onClick（浏览器在 drag 完成后不会派发 click），
 * 因此与「点击选中」互不冲突。
 */
export function useDragReorder<T extends { id: string }>(
  items: T[],
  onReorder: (orderedIds: string[]) => void,
) {
  const dragIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const handleDragStart = (id: string) => (e: DragEvent) => {
    dragIdRef.current = id;
    e.dataTransfer.effectAllowed = 'move';
    // 部分浏览器要求设置 data 才能开始拖拽
    try {
      e.dataTransfer.setData('text/plain', id);
    } catch {
      /* ignore */
    }
    // 延迟到下一帧再标记为「拖拽中」，让浏览器先以正常外观捕获拖拽影像（ghost），
    // 否则拖拽影像会被同步置灰
    requestAnimationFrame(() => setDraggingId(id));
  };

  const handleDragOver = (id: string) => (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverId !== id) setDragOverId(id);
  };

  const handleDrop = (id: string) => (e: DragEvent) => {
    e.preventDefault();
    const from = dragIdRef.current;
    const to = id;
    dragIdRef.current = null;
    setDragOverId(null);
    setDraggingId(null);
    if (!from || from === to) return;
    const ids = items.map((i) => i.id);
    const fromIdx = ids.indexOf(from);
    const toIdx = ids.indexOf(to);
    if (fromIdx < 0 || toIdx < 0) return;
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, from);
    onReorder(ids);
  };

  const handleDragEnd = () => {
    dragIdRef.current = null;
    setDragOverId(null);
    setDraggingId(null);
  };

  return {
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
    dragOverId,
    draggingId,
  };
}
