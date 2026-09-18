/**
 * 应用生命周期编排器（组合根门面）：
 * - start() 严格按 shell → core → background 推进，阶段结果存入局部常量；
 * - 只有这里持有完整 ApplicationContext；
 * - 致命启动失败有唯一顶层出口：failed → 结构化日志 → 关 Loading → 错误框 → 受控退出。
 */

import type { App } from "electron";
import { installAppShutdownHandlers } from "./electron-lifecycle";
import type { ApplicationContext } from "./context";
import type { StartupReadiness } from "./readiness";
import type { ShutdownCoordinator } from "./shutdown";
import type { WindowActivationBroker } from "./window-activation";
import type { PreReadyResult } from "./pre-ready";
import type { ShellResult } from "./shell-bootstrap";
import type { CoreResult } from "./core-bootstrap";
import type { BackgroundHandle } from "./background";

export interface ApplicationDependencies {
  app: Pick<App, "whenReady" | "quit" | "on" | "removeListener">;
  dialog: { showErrorBox(title: string, content: string): void };
  readiness: StartupReadiness;
  activation: WindowActivationBroker;
  shutdown: ShutdownCoordinator;
  prepare(): PreReadyResult;
  startShell(): Promise<ShellResult>;
  startCore(shell: ShellResult): Promise<CoreResult>;
  startBackground(core: CoreResult): BackgroundHandle;
  logFatal(error: unknown): void;
}

export interface Application {
  prepareBeforeReady(): void;
  isPrimaryProcess(): boolean;
  start(): Promise<void>;
  installLifecycleHandlers(): void;
  handleFatalStartup(error: unknown): Promise<void>;
}

const FATAL_CAPABLE_PHASES = ["preparing", "shell-ready", "core-ready", "background-starting"];

export function createApplication(deps: ApplicationDependencies): Application {
  let primaryResult: PreReadyResult | null = null;
  /** Loading 窗口在 startShell 后即可访问（core 失败时也要能关闭它）。 */
  let shell: ShellResult | null = null;
  let context: ApplicationContext | null = null;
  let fatalHandled = false;

  return {
    prepareBeforeReady(): void {
      primaryResult = deps.prepare();
    },

    isPrimaryProcess(): boolean {
      return primaryResult?.isPrimaryProcess ?? false;
    },

    async start(): Promise<void> {
      shell = await deps.startShell();
      const core = await deps.startCore(shell);
      deps.readiness.transition("background-starting");
      const background = deps.startBackground(core);
      context = {
        readiness: deps.readiness,
        activation: deps.activation,
        shutdown: deps.shutdown,
        shell,
        core,
        background,
      };
      await background.settled;
      // 内置 AI 引擎：随应用自动连接，失败不阻塞壳
      void import("../hermes/proc-mgr")
        .then((m) => m.ensureAiEngineRunning())
        .then((st) => {
          console.log("[AI引擎]", st.detail);
        })
        .catch((err) => {
          console.warn("[AI引擎] 启动失败", err);
        });
    },

    installLifecycleHandlers(): void {
      // before-quit 兜底入口：首次触发阻止默认退出并进入受控退出
      installAppShutdownHandlers({ app: deps.app, coordinator: deps.shutdown });
      // 全部窗口关闭不退出（托盘常驻，与旧行为一致）
      deps.app.on("window-all-closed", () => { /* no-op */ });
      // macOS 标准激活行为：统一走激活代理
      deps.app.on("activate", () => { deps.activation.request({ kind: "chat" }); });
    },

    async handleFatalStartup(error: unknown): Promise<void> {
      if (fatalHandled) return;
      fatalHandled = true;

      const phase = deps.readiness.getPhase();
      if (FATAL_CAPABLE_PHASES.includes(phase)) {
        try {
          deps.readiness.transition("failed");
        } catch (transitionError) {
          deps.logFatal(transitionError);
        }
      }
      deps.logFatal(error);

      // 关闭 Loading（如果已创建）
      const splash = context?.shell.splashWindow ?? shell?.splashWindow;
      if (splash && !splash.isDestroyed()) {
        try {
          splash.close();
        } catch { /* ignore */ }
      }

      const raw = error instanceof Error ? `${error.message}` : String(error);
      const isDevUrl =
        /ERR_CONNECTION_REFUSED|did-fail-load|localhost:\d+/i.test(raw) && process.env.VITE_DEV === "1";
      const message = isDevUrl
        ? [
            "开发服务器未就绪或端口已变。",
            "",
            "处理步骤：",
            "1. 以管理员身份在项目目录执行 scripts\\diagnostics\\restart-dev-full.ps1",
            "2. 或手动：npm run dev 后等待 Vite 就绪再打开应用",
            "3. 确认 dist/main/.vite-dev-url.json 与实际 Vite 端口一致",
            "",
            "技术细节：",
            raw.slice(0, 400),
          ].join("\n")
        : error instanceof Error
          ? `${error.message}\n\n${(error.stack ?? "").slice(0, 800)}`
          : String(error);
      try {
        deps.dialog.showErrorBox("应用启动失败", message);
      } catch (dialogError) {
        deps.logFatal(dialogError);
      }

      // 受控退出：固定阶段清理后以 app.quit() 作为最终动作
      await deps.shutdown.requestControlledShutdown({
        reason: "startup-fatal",
        finalAction: () => deps.app.quit(),
      });
    },
  };
}
