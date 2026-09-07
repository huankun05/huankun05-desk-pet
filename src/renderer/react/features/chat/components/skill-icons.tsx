import React from "react";

/**
 * 核心技能专属 SVG 图标库。
 * 每个技能一个 48 viewBox 线性图标（stroke=currentColor），容器内随文字色/置灰态自适应。
 * 未覆盖的技能 id 由调用方回退首字母占位。
 */

function I({ children, ...rest }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* 学业辅导（Learn Tutor）：学士帽 + 书本 */
const LearnTutorIcon = () => (
  <I>
    <path d="M24 12L4 20L24 28L44 20L24 12Z" />
    <path d="M12 24V30C12 34 17 38 24 38C31 38 36 34 36 30V24" />
    <path d="M30 21.5V28C30 30 27.5 32 24 32C20.5 32 18 30 18 28V21.5" />
    <path d="M8 22V34" />
  </I>
);

/* Obsidian 工作区：菱形宝石（Vault） */
const ObsidianWorkspaceIcon = () => (
  <I>
    <path d="M24 6L40 20L24 42L8 20L24 6Z" />
    <path d="M8 20H40" />
    <path d="M24 6V42" />
    <path d="M24 20L12 32M24 20L36 32" />
  </I>
);

/* 原作语气：Voice 声波 */
const OriginalVoiceIcon = () => (
  <I>
    <path d="M10 18V30M5 14V34M15 8V40M20 12V36M25 18V30M30 20V28M35 22V26" />
    <path d="M39 16L43 20L39 24" />
  </I>
);

/* 计划模式：勾选清单 */
const PlanModeIcon = () => (
  <I>
    <rect x="8" y="6" width="32" height="36" rx="4" />
    <path d="M16 12H32M16 20H32" />
    <path d="M16 28H24M16 34H24" />
    <path d="M30 32L33 35L38 29" />
  </I>
);

/* 插件开发：拼图块 */
const PluginDevIcon = () => (
  <I>
    <path d="M12 8H24C26.2 8 28 9.8 28 12V16H32C35.3 16 38 18.7 38 22C38 25.3 35.3 28 32 28H28V34C28 36.2 26.2 38 24 38H12C9.8 38 8 36.2 8 34V12C8 9.8 9.8 8 12 8Z" />
    <circle cx="30" cy="26" r="3" fill="currentColor" stroke="none" />
  </I>
);

/* 工作整洁：多层文件夹整理 */
const WorkHygieneIcon = () => (
  <I>
    <path d="M6 14C6 11.8 7.8 10 10 10H17L21 14H38C40.2 14 42 15.8 42 18V34C42 36.2 40.2 38 38 38H10C7.8 38 6 36.2 6 34V14Z" />
    <path d="M14 22H34M14 28H28" />
  </I>
);

/** 技能 id（= 目录名，kebab-case）→ 图标映射。未覆盖的技能回退首字母占位。 */
export const SKILL_ICON_SVGS: Record<string, React.ReactNode> = {
  "cyrene-learn-tutor": <LearnTutorIcon />,
  "cyrene-obsidian-workspace": <ObsidianWorkspaceIcon />,
  "cyrene-original-voice": <OriginalVoiceIcon />,
  "cyrene-plan-mode": <PlanModeIcon />,
  "cyrene-plugin-dev": <PluginDevIcon />,
  "cyrene-work-hygiene": <WorkHygieneIcon />,
};