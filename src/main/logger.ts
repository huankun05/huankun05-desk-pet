/**
 * Main-process wrapper around the shared logger.
 *
 * Responsibilities on top of src/shared/logger.ts:
 *   - Apply the dev-vs-release default level (info when unpackaged, warn
 *     when packaged) by calling setLogLevel() at module init.
 *   - Re-export LogTag from the shared location so call sites can
 *     `import { LogTag } from "../logger"`.
 */
import { app } from "electron";
import { setLogLevel, type LogLevel, setLogRedactor } from "../shared/logger";
import { logger } from "../shared/logger";
import { installFileLogSink } from "./log-sink-file";
import { redactSensitiveText } from "./orchestrator/security/message-redactor";

function resolveDefaultLevel(): LogLevel {
  // env wins
  const env = process.env.CYRENE_LOG_LEVEL?.toLowerCase();
  if (env === "debug" || env === "info" || env === "warn" || env === "error") {
    return env;
  }
  // Both dev and release: warn by default. Startup prints the banner plus
  // whatever warn/error fires during init; set CYRENE_LOG_LEVEL=info to see
  // the full startup trace.
  return "warn";
}

setLogLevel(resolveDefaultLevel());

// 注册日志脱敏：自动脱敏所有日志输出中的 API key、token、密码等敏感信息。
// 安全默认：启用。可通过环境变量 CYRENE_LOG_REDACT=false 关闭（仅用于调试脱敏本身）。
const logRedactEnabled = process.env.CYRENE_LOG_REDACT?.toLowerCase() !== "false";
if (logRedactEnabled) {
  setLogRedactor(redactSensitiveText);
}

// 打包版 stdout 不可见：把日志同步落盘到 userData/logs/cyrene.log（滚动 3 份×5MB），
// 用户/issue 上报可直接附日志文件。dev 下同样落盘，便于本地排查。
try {
  installFileLogSink(app.getPath("userData"));
} catch {
  // userData 不可用时静默跳过，日志落盘只是增强项
}

export { logger, setLogLevel, setLogRedactor, LogTag } from "../shared/logger";
export type { LogLevel } from "../shared/logger";
