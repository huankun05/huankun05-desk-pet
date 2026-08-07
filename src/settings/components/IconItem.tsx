import { Icon } from '@iconify/react';
import { useNavigate } from 'react-router-dom';

interface IconItemProps {
  /** Solar duotone 图标名（如 solar:palette-duotone） */
  icon: string;
  title: string;
  description: string;
  /** 目标路由路径 */
  to: string;
  /** 用于交错动画延迟（ms 倍数） */
  index?: number;
}

/**
 * IconItem — 设置入口列表项组件
 *
 * 完整复刻 AIRI 的 icon-item.vue 设计：
 * - 背景：neutral-50 浅灰
 * - 边框：2px solid neutral-100，hover 变 primary-500/30
 * - 右侧 96px 大图标（absolute right-0 translate-y-4，半透明）
 * - 无 chevron 箭头
 * - 悬停效果：
 *   - ::before 渐变层（25% → 85% 宽，primary-500/20 渐变）
 *   - ::after 点阵纹理（10px×10px 圆点，165deg 遮罩）
 *   - 阴影：0px 4px 4px rgba(220,220,220,0.4)
 *   - 文字变色为 primary-600
 *   - 图标放大 1.2 倍 + 变色
 */
export function IconItem({ icon, title, description, to, index = 0 }: IconItemProps) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(to)}
      className="menu-icon-item group"
      style={{
        animation: 'fade-in-up 250ms ease forwards',
        animationDelay: `${index * 50}ms`,
        opacity: 0,
      }}
    >
      <div className="menu-icon-item-content z-1 flex-1">
        <div className="menu-icon-item-title text-lg font-normal transition-all duration-400">
          {title}
        </div>
        <div className="menu-icon-item-description text-sm text-neutral-500 transition-all duration-400">
          <span>{description}</span>
        </div>
      </div>
      <Icon
        icon={icon}
        className="menu-icon-item-icon absolute right-0 size-24 translate-y-4 text-neutral-400/50 transition-all duration-400 shrink-0"
      />
    </button>
  );
}
