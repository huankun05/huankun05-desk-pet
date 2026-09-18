/** Hermes 大脑运行时配置（壳内设置的持久化字段） */

export type HermesSettings = {
  /** Hermes 源码/安装目录（含 cli.py 或 hermes 可执行） */
  sourceDir: string;
  /** HERMES_HOME（会话/技能/日志数据目录） */
  homeDir: string;
  /** uv 可执行文件；空则探测 PATH / 常见安装位置 */
  uvPath: string;
  /** API server 监听端口 */
  apiPort: number;
  /** API server 绑定地址 */
  apiHost: string;
  /** 与 gateway 通信的密钥（写入 HERMES_HOME/.env 的 API_SERVER_KEY） */
  apiServerKey: string;
  /** 启动应用时是否自动拉起 gateway */
  autoStartGateway: boolean;
  /** 保存模型设置后是否自动同步凭据到 Hermes .env */
  syncModelCredentials: boolean;
  /** 送给 Hermes 的默认模型 id（写入 config.yaml model.default，可空） */
  defaultModel: string;
  /** 模型 provider（openrouter/openai/xiaomi/ollama/...，可空） */
  modelProvider: string;
};

export type HermesHealthStatus = {
  ok: boolean;
  status: number;
  body: string;
  baseUrl: string;
};

export type HermesSettingsPublic = HermesSettings & {
  /** 探测到的默认路径（展示用） */
  defaults: {
    sourceDir: string;
    homeDir: string;
    uvPath: string;
  };
  health: HermesHealthStatus | null;
  /** .env 是否存在 */
  envExists: boolean;
};

export const DEFAULT_HERMES_SETTINGS: HermesSettings = {
  sourceDir: "",
  homeDir: "",
  uvPath: "",
  apiPort: 8642,
  apiHost: "127.0.0.1",
  apiServerKey: "",
  autoStartGateway: false,
  syncModelCredentials: true,
  defaultModel: "",
  modelProvider: "",
};

export function normalizeHermesSettings(input: Partial<HermesSettings> | null | undefined): HermesSettings {
  const raw = input ?? {};
  const port = Number(raw.apiPort);
  return {
    sourceDir: typeof raw.sourceDir === "string" ? raw.sourceDir.trim() : "",
    homeDir: typeof raw.homeDir === "string" ? raw.homeDir.trim() : "",
    uvPath: typeof raw.uvPath === "string" ? raw.uvPath.trim() : "",
    apiPort: Number.isFinite(port) && port > 0 && port < 65535 ? Math.floor(port) : DEFAULT_HERMES_SETTINGS.apiPort,
    apiHost: typeof raw.apiHost === "string" && raw.apiHost.trim() ? raw.apiHost.trim() : DEFAULT_HERMES_SETTINGS.apiHost,
    apiServerKey: typeof raw.apiServerKey === "string" ? raw.apiServerKey.trim() : "",
    autoStartGateway: Boolean(raw.autoStartGateway),
    syncModelCredentials: raw.syncModelCredentials !== false,
    defaultModel: typeof raw.defaultModel === "string" ? raw.defaultModel.trim() : "",
    modelProvider: typeof raw.modelProvider === "string" ? raw.modelProvider.trim() : "",
  };
}

export function generateApiServerKey(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 40; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
