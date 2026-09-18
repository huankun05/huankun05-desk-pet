import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import {
  DEFAULT_HERMES_SETTINGS,
  generateApiServerKey,
  normalizeHermesSettings,
  type HermesHealthStatus,
  type HermesSettings,
  type HermesSettingsPublic,
} from "../../shared/hermes-settings-types";

function workspaceRootFromApp(): string {
  // dev: .../desk-pet；生产 userData 旁也可覆盖 sourceDir/homeDir
  const appPath = app.getAppPath();
  // desk-pet → desk_pet workspace root
  return path.resolve(appPath, "..");
}

export function resolveDefaultHermesPaths(): { sourceDir: string; homeDir: string; uvPath: string } {
  const root = workspaceRootFromApp();
  const sourceDir = path.join(root, "hermes-agent");
  const homeDir = path.join(root, ".runtime", "hermes-home");
  const candidates = [
    process.env.UV_PATH ?? "",
    "E:\\software\\Python3.12\\Scripts\\uv.exe",
    path.join(process.env.LOCALAPPDATA ?? "", "Programs", "uv", "uv.exe"),
  ];
  const uvPath = candidates.find((p) => p && fs.existsSync(p)) ?? "uv";
  return { sourceDir, homeDir, uvPath };
}

function settingsFilePath(): string {
  return path.join(app.getPath("userData"), "hermes-settings.json");
}

let cache: HermesSettings | null = null;

export function loadHermesSettings(): HermesSettings {
  if (cache) return cache;
  try {
    const file = settingsFilePath();
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<HermesSettings>;
      cache = normalizeHermesSettings(parsed);
      return cache;
    }
  } catch {
    /* fall through */
  }
  const defaults = resolveDefaultHermesPaths();
  cache = normalizeHermesSettings({
    ...DEFAULT_HERMES_SETTINGS,
    sourceDir: defaults.sourceDir,
    homeDir: defaults.homeDir,
    uvPath: defaults.uvPath,
  });
  return cache;
}

export function saveHermesSettings(patch: Partial<HermesSettings>): HermesSettings {
  const merged = normalizeHermesSettings({ ...loadHermesSettings(), ...patch });
  cache = merged;
  try {
    fs.mkdirSync(path.dirname(settingsFilePath()), { recursive: true });
    fs.writeFileSync(settingsFilePath(), JSON.stringify(merged, null, 2), "utf8");
  } catch (err) {
    console.error("[HermesSettings] save failed", err);
  }
  return merged;
}

function readEnvFile(envPath: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(envPath)) return map;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) map.set(m[1], m[2].trim());
  }
  return map;
}

function writeEnvFile(envPath: string, map: Map<string, string>): void {
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  const lines = Array.from(map.entries()).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(envPath, lines.join("\n") + "\n", "utf8");
}

/** 把壳内 Hermes 设置落到 HERMES_HOME/.env（api key / host / port 等） */
export function writeHermesRuntimeEnv(settings: HermesSettings = loadHermesSettings()): { envPath: string; ok: boolean } {
  const home = settings.homeDir || resolveDefaultHermesPaths().homeDir;
  const envPath = path.join(home, ".env");
  try {
    fs.mkdirSync(home, { recursive: true });
    const map = readEnvFile(envPath);
    const key = settings.apiServerKey || map.get("API_SERVER_KEY") || generateApiServerKey();
    map.set("API_SERVER_KEY", key);
    map.set("API_SERVER_PORT", String(settings.apiPort || 8642));
    map.set("API_SERVER_HOST", settings.apiHost || "127.0.0.1");
    map.set("HERMES_HOME", home);
    if (settings.defaultModel) map.set("HERMES_MODEL", settings.defaultModel);
    if (!map.has("API_SERVER_KEY")) map.set("API_SERVER_KEY", generateApiServerKey());
    writeEnvFile(envPath, map);
    // 回写生成的 key，避免用户看到空值
    if (!settings.apiServerKey && map.get("API_SERVER_KEY")) {
      saveHermesSettings({ apiServerKey: map.get("API_SERVER_KEY") ?? "", homeDir: home });
    }
    return { envPath, ok: true };
  } catch (err) {
    console.error("[HermesSettings] write env failed", err);
    return { envPath, ok: false };
  }
}

/** 从 ModelSettings 抽取常见厂商 key，合并进 Hermes .env */
export function syncModelCredentialsToHermes(
  modelSettings: { provider?: string; apiKey?: string; perProvider?: Record<string, { apiKey?: string }> },
  settings: HermesSettings = loadHermesSettings(),
): { envPath: string; written: string[] } {
  const home = settings.homeDir || resolveDefaultHermesPaths().homeDir;
  const envPath = path.join(home, ".env");
  const map = readEnvFile(envPath);
  const written: string[] = [];

  const put = (envKey: string, value?: string) => {
    const v = (value ?? "").trim();
    if (!v) return;
    map.set(envKey, v);
    written.push(envKey);
  };

  const provider = (modelSettings.provider ?? "").toLowerCase();
  const topKey = modelSettings.apiKey ?? "";
  if (provider.includes("openrouter")) put("OPENROUTER_API_KEY", topKey);
  else if (provider.includes("openai") || provider.includes("azure")) put("OPENAI_API_KEY", topKey);
  else if (provider.includes("xiaomi") || provider.includes("mimo") || provider.includes("小米")) put("XIAOMI_API_KEY", topKey);
  else if (provider.includes("anthropic") || provider.includes("claude")) put("ANTHROPIC_API_KEY", topKey);
  else if (provider.includes("glm") || provider.includes("zhipu") || provider.includes("智谱") || provider.includes("z.ai")) put("GLM_API_KEY", topKey);
  else if (provider.includes("kimi") || provider.includes("moonshot")) put("KIMI_API_KEY", topKey);
  else if (provider.includes("minimax")) put("MINIMAX_API_KEY", topKey);
  else if (provider.includes("deepseek")) put("DEEPSEEK_API_KEY", topKey);
  else if (provider.includes("ollama")) put("OLLAMA_HOST", "http://127.0.0.1:11434");
  else if (topKey) put("OPENAI_API_KEY", topKey);

  const per = modelSettings.perProvider ?? {};
  for (const [name, val] of Object.entries(per)) {
    const n = name.toLowerCase();
    const k = (val?.apiKey ?? "").trim();
    if (!k) continue;
    if (n.includes("openrouter")) put("OPENROUTER_API_KEY", k);
    if (n.includes("openai")) put("OPENAI_API_KEY", k);
    if (n.includes("xiaomi") || n.includes("mimo")) put("XIAOMI_API_KEY", k);
    if (n.includes("anthropic")) put("ANTHROPIC_API_KEY", k);
    if (n.includes("glm") || n.includes("zhipu")) put("GLM_API_KEY", k);
    if (n.includes("kimi") || n.includes("moonshot")) put("KIMI_API_KEY", k);
    if (n.includes("minimax")) put("MINIMAX_API_KEY", k);
  }

  if (settings.apiServerKey) map.set("API_SERVER_KEY", settings.apiServerKey);
  map.set("API_SERVER_PORT", String(settings.apiPort || 8642));
  map.set("API_SERVER_HOST", settings.apiHost || "127.0.0.1");
  map.set("HERMES_HOME", home);
  fs.mkdirSync(home, { recursive: true });
  writeEnvFile(envPath, map);
  return { envPath, written };
}

/** 尽力写入/合并 HERMES_HOME/config.yaml 的 model 段（最小 YAML 补丁） */
export function writeHermesModelConfig(settings: HermesSettings = loadHermesSettings()): { configPath: string; ok: boolean } {
  const home = settings.homeDir || resolveDefaultHermesPaths().homeDir;
  const configPath = path.join(home, "config.yaml");
  try {
    fs.mkdirSync(home, { recursive: true });
    let text = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
    const modelDefault = settings.defaultModel;
    const provider = settings.modelProvider;
    const block = [
      "model:",
      `  default: ${modelDefault ? `"${modelDefault}"` : '"hermes-agent"'}`,
      provider ? `  provider: "${provider}"` : null,
    ]
      .filter(Boolean)
      .join("\n");

    if (!text.trim()) {
      text = block + "\n";
    } else if (/^model:\s*$/m.test(text) || /^model:/m.test(text)) {
      // 替换已有 model: 段（简单场景：到下一个顶层键为止）
      const lines = text.split(/\r?\n/);
      const out: string[] = [];
      let skip = false;
      for (const line of lines) {
        if (/^model:\s*$/.test(line) || /^model:/.test(line)) {
          skip = true;
          out.push(...block.split("\n"));
          continue;
        }
        if (skip) {
          if (/^\S/.test(line)) {
            skip = false;
            out.push(line);
          }
          continue;
        }
        out.push(line);
      }
      text = out.join("\n");
    } else {
      text = text.trimEnd() + "\n" + block + "\n";
    }
    fs.writeFileSync(configPath, text, "utf8");
    return { configPath, ok: true };
  } catch (err) {
    console.error("[HermesSettings] write config.yaml failed", err);
    return { configPath, ok: false };
  }
}

export async function probeHermesHealth(settings: HermesSettings = loadHermesSettings()): Promise<HermesHealthStatus> {
  const baseUrl = `http://${settings.apiHost || "127.0.0.1"}:${settings.apiPort || 8642}`;
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body, baseUrl };
  } catch (err) {
    return { ok: false, status: 0, body: String(err), baseUrl };
  }
}

export function getHermesSettingsPublic(): HermesSettingsPublic {
  const settings = loadHermesSettings();
  const defaults = resolveDefaultHermesPaths();
  const home = settings.homeDir || defaults.homeDir;
  return {
    ...settings,
    defaults,
    health: null,
    envExists: fs.existsSync(path.join(home, ".env")),
  };
}

export function getHermesRuntimeSnapshot(): {
  settings: HermesSettingsPublic;
  health: HermesHealthStatus | null;
  envExists: boolean;
} {
  const settings = loadHermesSettings();
  const home = settings.homeDir || resolveDefaultHermesPaths().homeDir;
  return {
    settings: getHermesSettingsPublic(),
    health: null,
    envExists: fs.existsSync(path.join(home, ".env")),
  };
}
