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
  return path.resolve(app.getAppPath(), "..");
}

/** 自动探测 Hermes 源码目录：应用旁 / 打包资源 / 环境变量 / 常见安装位 */
export function discoverHermesSourceDir(): string {
  const resources = typeof process.resourcesPath === "string" ? process.resourcesPath : "";
  const candidates = [
    process.env.HERMES_SOURCE_DIR?.trim() ?? "",
    path.join(workspaceRootFromApp(), "hermes-agent"),
    path.join(workspaceRootFromApp(), "..", "hermes-agent"),
    resources ? path.join(resources, "hermes-agent") : "",
    path.join(process.env.LOCALAPPDATA ?? "", "hermes", "hermes-agent"),
  ].filter((d): d is string => Boolean(d));
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "cli.py")) || fs.existsSync(path.join(dir, "pyproject.toml"))) {
      return dir;
    }
  }
  return path.join(workspaceRootFromApp(), "hermes-agent");
}

export function discoverHermesHome(): string {
  const candidates = [
    process.env.HERMES_HOME?.trim() ?? "",
    path.join(workspaceRootFromApp(), ".runtime", "hermes-home"),
    path.join(app.getPath("userData"), "hermes-home"),
    path.join(process.env.LOCALAPPDATA ?? "", "hermes"),
  ].filter((d): d is string => Boolean(d));
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return path.join(workspaceRootFromApp(), ".runtime", "hermes-home");
}

export function discoverUvPath(): string {
  const candidates = [
    process.env.UV_PATH?.trim(),
    "E:\\software\\Python3.12\\Scripts\\uv.exe",
    path.join(process.env.LOCALAPPDATA ?? "", "Programs", "uv", "uv.exe"),
  ].filter(Boolean);
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return "uv";
}

export function resolveDefaultHermesPaths(): { sourceDir: string; homeDir: string; uvPath: string } {
  return {
    sourceDir: discoverHermesSourceDir(),
    homeDir: discoverHermesHome(),
    uvPath: discoverUvPath(),
  };
}

/** 应用默认：不写盘前的运行配置（路径自动探测，用户可不填） */
export function resolveEffectiveHermesSettings(settings?: HermesSettings): HermesSettings {
  const saved = settings ?? loadHermesSettings();
  const auto = resolveDefaultHermesPaths();
  return normalizeHermesSettings({
    ...saved,
    sourceDir: saved.sourceDir || auto.sourceDir,
    homeDir: saved.homeDir || auto.homeDir,
    uvPath: saved.uvPath || auto.uvPath,
  });
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
  cache = normalizeHermesSettings(DEFAULT_HERMES_SETTINGS);
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

export function writeHermesRuntimeEnv(raw?: HermesSettings): { envPath: string; ok: boolean } {
  const settings = resolveEffectiveHermesSettings(raw);
  const home = settings.homeDir;
  const envPath = path.join(home, ".env");
  try {
    fs.mkdirSync(home, { recursive: true });
    const map = readEnvFile(envPath);
    const key = settings.apiServerKey || map.get("API_SERVER_KEY") || generateApiServerKey();
    map.set("API_SERVER_KEY", key);
    map.set("API_SERVER_PORT", String(settings.apiPort || 8642));
    map.set("API_SERVER_HOST", settings.apiHost || "127.0.0.1");
    map.set("HERMES_HOME", home);
    writeEnvFile(envPath, map);
    if (!settings.apiServerKey && map.get("API_SERVER_KEY")) {
      saveHermesSettings({ apiServerKey: map.get("API_SERVER_KEY") ?? "" });
    }
    return { envPath, ok: true };
  } catch (err) {
    console.error("[HermesSettings] write env failed", err);
    return { envPath, ok: false };
  }
}

export function syncModelCredentialsToHermes(
  modelSettings: { provider?: string; apiKey?: string; model?: string; perProvider?: Record<string, { apiKey?: string; model?: string }> },
  raw?: HermesSettings,
): { envPath: string; written: string[]; configPath: string } {
  const settings = resolveEffectiveHermesSettings(raw);
  const home = settings.homeDir;
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

  const modelDefault = settings.defaultModel || modelSettings.model || "";
  const providerOut = settings.modelProvider || modelSettings.provider || "";
  const configPath = path.join(home, "config.yaml");
  try {
    let text = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
    const block = [
      "model:",
      `  default: ${modelDefault ? `"${modelDefault}"` : '"hermes-agent"'}`,
      providerOut ? `  provider: "${providerOut}"` : null,
    ]
      .filter(Boolean)
      .join("\n");
    if (!text.trim()) text = block + "\n";
    else if (/^model:/m.test(text)) {
      const lines = text.split(/\r?\n/);
      const out: string[] = [];
      let skip = false;
      for (const line of lines) {
        if (/^model:/.test(line)) {
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
  } catch (err) {
    console.error("[HermesSettings] write config.yaml failed", err);
  }

  return { envPath, written, configPath };
}

export function writeHermesModelConfig(raw?: HermesSettings): { configPath: string; ok: boolean } {
  const settings = resolveEffectiveHermesSettings(raw);
  const configPath = path.join(settings.homeDir, "config.yaml");
  try {
    fs.mkdirSync(settings.homeDir, { recursive: true });
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
    if (!text.trim()) text = block + "\n";
    else if (/^model:/m.test(text)) {
      const lines = text.split(/\r?\n/);
      const out: string[] = [];
      let skip = false;
      for (const line of lines) {
        if (/^model:/.test(line)) {
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

export async function probeHermesHealth(raw?: HermesSettings): Promise<HermesHealthStatus> {
  const settings = resolveEffectiveHermesSettings(raw);
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
  const saved = loadHermesSettings();
  const effective = resolveEffectiveHermesSettings(saved);
  const defaults = resolveDefaultHermesPaths();
  return {
    ...effective,
    // 回填探测结果，便于 UI 只读展示
    sourceDir: effective.sourceDir,
    homeDir: effective.homeDir,
    uvPath: effective.uvPath,
    defaults,
    health: null,
    envExists: fs.existsSync(path.join(effective.homeDir, ".env")),
  };
}
