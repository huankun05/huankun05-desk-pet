// curator-tools —— Curator 后台维护的管理工具。
// 提供 skill_curator 工具，让 Agent 可以手动触发 Curator 运行、查看状态、pin/unpin 技能、恢复归档技能。

import type { ToolDefinition } from "../orchestrator/tools/registry/tool-registry";
import { logger, LogTag } from "../logger";
import {
  runCurator,
  getCuratorStatus,
  pinSkill,
  unpinSkill,
  restoreArchivedSkill,
  listArchivedSkills,
  loadCuratorConfig,
  saveCuratorConfig,
} from "./curator";

async function executeSkillCurator(args: Record<string, unknown>): Promise<string> {
  const action = String(args.action || "").trim();
  const name = args.name ? String(args.name).trim() : "";
  const force = args.force === true;
  const dryRun = args.dryRun === true;

  if (!action) {
    return JSON.stringify({
      success: false,
      error: "action 参数必填，可选：run / status / pin / unpin / list-archived / restore / config",
    });
  }

  switch (action) {
    case "run": {
      logger.info(LogTag.Skills, `手动触发 Curator 运行 (force=${force}, dryRun=${dryRun})`);
      const result = await runCurator({ force, dryRun });
      return JSON.stringify(result);
    }

    case "status": {
      const status = getCuratorStatus();
      return JSON.stringify({
        success: true,
        enabled: status.config.enabled,
        shouldRun: status.shouldRun,
        lastRun: status.lastRun,
        intervalHours: status.config.intervalHours,
        staleAfterDays: status.config.staleAfterDays,
        archiveAfterDays: status.config.archiveAfterDays,
        archivedCount: status.archivedCount,
      });
    }

    case "pin": {
      if (!name) return JSON.stringify({ success: false, error: "pin 操作需要 name 参数" });
      const ok = pinSkill(name);
      return JSON.stringify({ success: ok, message: ok ? `技能 '${name}' 已 pin，不会被自动归档` : `pin 失败：找不到技能 '${name}'` });
    }

    case "unpin": {
      if (!name) return JSON.stringify({ success: false, error: "unpin 操作需要 name 参数" });
      const ok = unpinSkill(name);
      return JSON.stringify({ success: ok, message: ok ? `技能 '${name}' 已 unpin` : `unpin 失败：找不到技能 '${name}'` });
    }

    case "list-archived": {
      const archived = listArchivedSkills();
      return JSON.stringify({
        success: true,
        count: archived.length,
        skills: archived,
      });
    }

    case "restore": {
      if (!name) return JSON.stringify({ success: false, error: "restore 操作需要 name 参数" });
      const ok = restoreArchivedSkill(name);
      return JSON.stringify({ success: ok, message: ok ? `技能 '${name}' 已从归档恢复` : `恢复失败：归档中找不到技能 '${name}'` });
    }

    case "config": {
      const config = loadCuratorConfig();
      // 如果提供了配置更新参数，保存
      const updates: Record<string, unknown> = {};
      if (args.enabled !== undefined) updates.enabled = Boolean(args.enabled);
      if (args.intervalHours !== undefined) updates.intervalHours = Number(args.intervalHours);
      if (args.staleAfterDays !== undefined) updates.staleAfterDays = Number(args.staleAfterDays);
      if (args.archiveAfterDays !== undefined) updates.archiveAfterDays = Number(args.archiveAfterDays);
      if (Object.keys(updates).length > 0) {
        const updated = saveCuratorConfig(updates);
        return JSON.stringify({ success: true, message: "Curator 配置已更新", config: updated });
      }
      return JSON.stringify({ success: true, config });
    }

    default:
      return JSON.stringify({
        success: false,
        error: `未知 action '${action}'，可选：run / status / pin / unpin / list-archived / restore / config`,
      });
  }
}

export const skillCuratorTool: ToolDefinition = {
  id: "skill_curator",
  name: "技能维护",
  description:
    "管理自进化技能系统的后台维护（Curator）。\n\n" +
    "Actions:\n" +
    "- run — 手动触发 Curator 运行（检查长期未用的技能，标记 stale/归档）。可选 force=true 强制运行，dryRun=true 只预览不修改\n" +
    "- status — 查看 Curator 状态（是否启用、上次运行时间、归档数量）\n" +
    "- pin — 保护某个技能不被自动归档（需要 name 参数）\n" +
    "- unpin — 取消技能保护（需要 name 参数）\n" +
    "- list-archived — 列出所有已归档的技能\n" +
    "- restore — 从归档恢复某个技能（需要 name 参数）\n" +
    "- config — 查看或修改 Curator 配置（enabled / intervalHours / staleAfterDays / archiveAfterDays）\n\n" +
    "Curator 会自动在后台运行（默认每 7 天，应用启动时检查），把 30 天未用的技能标记为 stale，90 天未用的归档。被 pin 的技能不受影响。",
  enabled: true,
  risk: "safe",
  effectKind: "read",
  verificationPolicy: "none",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["run", "status", "pin", "unpin", "list-archived", "restore", "config"],
        description: "操作类型",
      },
      name: { type: "string", description: "技能名称（pin/unpin/restore 时必填）" },
      force: { type: "boolean", description: "run 时是否强制运行（忽略间隔检查）" },
      dryRun: { type: "boolean", description: "run 时是否只预览不修改" },
      enabled: { type: "boolean", description: "config 时是否启用 Curator" },
      intervalHours: { type: "number", description: "config 时运行间隔（小时）" },
      staleAfterDays: { type: "number", description: "config 时多少天未用标记 stale" },
      archiveAfterDays: { type: "number", description: "config 时多少天未用归档" },
    },
    required: ["action"],
  },
  execute: executeSkillCurator,
};

import { toolRegistry } from "../orchestrator/tools/registry/tool-registry";

export function registerCuratorTools(): void {
  toolRegistry.register(skillCuratorTool);
}
