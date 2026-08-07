import type { ReactNode } from 'react';

interface SectionProps {
  /** 分组标题 */
  title?: string;
  /** 分组描述 */
  description?: string;
  /** 具体设置项（通常为多个 SettingRow） */
  children: ReactNode;
}

/**
 * Section — 设置项分组容器
 *
 * 渲染为带标题和描述的卡片分组，children 是具体的设置项
 * 标题：text-sm font-semibold
 * 描述：text-xs text-neutral-400
 * 卡片：白色背景，圆角 12px，边框
 */
export function Section({ title, description, children }: SectionProps) {
  return (
    <section className="mb-6">
      {(title || description) && (
        <div className="mb-2 px-1">
          {title && <h2 className="text-sm font-semibold text-neutral-700">{title}</h2>}
          {description && <p className="text-xs text-neutral-400 mt-0.5">{description}</p>}
        </div>
      )}
      <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
        {children}
      </div>
    </section>
  );
}
