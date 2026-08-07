import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Icon } from '@iconify/react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** 是否禁用返回按钮（如设置首页） */
  disableBackButton?: boolean;
  /** 后退回退路由（无历史时的兜底） */
  fallbackRoute?: string;
  /** 标题右侧自定义区域（如搜索框） */
  actions?: ReactNode;
}

/**
 * PageHeader — 设置页面头部
 *
 * 复刻 AIRI 的 page-header.vue：
 * - 固定在可滚动内容区上方（由 SettingsLayout 控制滚动）
 * - 返回按钮（i-solar:alt-arrow-left-line-duotone，2xl 大小）
 * - text-3xl font-normal 大标题
 * - 副标题位于标题上方（absolute translate-y-[-80%]，text-neutral-300，小号）
 * - 路由切换时的进入/离开动画：x 10→0 + opacity
 */
export function PageHeader({
  title,
  subtitle,
  disableBackButton = false,
  fallbackRoute = '/settings',
  actions,
}: PageHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const headerRef = useRef<HTMLDivElement>(null);
  const animKeyRef = useRef(0);
  const [animKey, setAnimKey] = useState(0);

  useEffect(() => {
    animKeyRef.current += 1;
    setAnimKey(animKeyRef.current);
  }, [location.pathname, title, subtitle]);

  const handleBack = () => {
    // 有历史栈时优先回退历史：无论是「跨分区跳转」（如聊天语音→语音唤醒，
    // 返回刚才的页面）还是「父子级跳转」（如聊天→语音，返回上一极），
    // 回退历史栈都能精确回到来路，无需按 pathname 臆测父级。
    // 初始渲染的 location.key 为 'default'；非 default 即存在前序历史。
    if (location.key && location.key !== 'default') {
      navigate(-1);
      return;
    }
    // 无历史（如从主窗口深链直达深层页）：按父分区兜底
    // /settings/services/tts -> /settings/services；/settings/services -> /settings
    const segments = location.pathname.split('/').filter(Boolean);
    if (segments.length <= 1) {
      // 已在根（/settings），回退到兜底路由
      navigate(fallbackRoute);
      return;
    }
    const parentPath = '/' + segments.slice(0, -1).join('/');
    navigate(parentPath);
  };

  return (
    <div
      key={animKey}
      ref={headerRef}
      className="page-header relative z-[99] w-full shrink-0 pb-6 pt-10 px-4 flex items-center gap-2 bg-[var(--bg-color,#fff)]"
      style={{
        animation: 'page-header-enter 250ms ease forwards',
      }}
    >
      <button
        onClick={handleBack}
        className="shrink-0 transition-opacity"
        aria-label="返回"
        style={{
          opacity: disableBackButton ? 0 : 1,
          pointerEvents: disableBackButton ? 'none' : 'auto',
        }}
      >
        <Icon icon="solar:alt-arrow-left-line-duotone" className="text-2xl text-neutral-600" />
      </button>
      <h1 className="relative">
        {subtitle && (
          <div className="absolute left-0 top-0 -translate-y-[80%]">
            <span className="text-nowrap text-sm text-neutral-300">{subtitle}</span>
          </div>
        )}
        <div className="text-nowrap text-3xl font-normal text-neutral-800">{title}</div>
      </h1>
      {actions && <div className="ml-auto flex shrink-0 items-center">{actions}</div>}
    </div>
  );
}
