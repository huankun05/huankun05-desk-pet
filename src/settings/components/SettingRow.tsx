import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

interface SettingRowProps {
  title: string;
  description?: string;
  to?: string;
  children?: ReactNode;
}

export function SettingRow({ title, description, to, children }: SettingRowProps) {
  const navigate = useNavigate();

  const content = (
    <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-neutral-100 last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-neutral-800">{title}</div>
        {description && <div className="text-xs text-neutral-400 mt-0.5">{description}</div>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );

  if (to) {
    return (
      <button
        type="button"
        onClick={() => navigate(to)}
        className="w-full text-left transition-colors hover:bg-neutral-50"
      >
        {content}
      </button>
    );
  }

  return content;
}
