import { useNavigate } from 'react-router-dom';
import { Icon } from '@iconify/react';

interface SettingsJumpButtonProps {
  /** 目标设置路由（基于 createHashRouter 的 path，如 '/settings/models/behavior'） */
  to: string;
  /** 按钮显示文字（建议传目标页标题，如「角色行为」） */
  label: string;
  /** 按钮左侧图标（Solar duotone 图标名），默认箭头 */
  icon?: string;
  /** 按钮上方可选的说明文字 */
  hint?: string;
}

/**
 * 设置页内的跨页跳转按钮。
 *
 * 用于「本页提到的设置其实在另一个页面」的场景：点击直接用 react-router
 * navigate 跳转到目标设置页（设置窗口本身已挂载，无需走跨 webview 深链）。
 */
export function SettingsJumpButton({ to, label, icon, hint }: SettingsJumpButtonProps) {
  const navigate = useNavigate();
  return (
    <div className="space-y-2">
      {hint && <p className="text-xs text-neutral-400">{hint}</p>}
      <button
        type="button"
        onClick={() => navigate(to)}
        className="group flex w-full items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-left transition-colors hover:border-[var(--primary-300)] hover:bg-[var(--primary-50)]/50"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 transition-colors group-hover:bg-[var(--primary-500)] group-hover:text-white">
          <Icon icon={icon ?? 'solar:arrow-right-outline'} className="text-lg" />
        </span>
        <span className="flex-1 text-sm font-medium text-neutral-800">{label}</span>
        <Icon
          icon="solar:alt-arrow-right-outline"
          className="text-base text-neutral-400 transition-colors group-hover:text-[var(--primary-500)]"
        />
      </button>
    </div>
  );
}

export default SettingsJumpButton;
