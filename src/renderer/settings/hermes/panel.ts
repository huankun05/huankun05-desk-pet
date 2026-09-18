/**
 * 大脑 Hermes 设置面板
 * 在壳内配置 HERMES_HOME / 路径 / 端口 / API_SERVER_KEY / 模型同步，无需手改源文件。
 */

type HermesPublic = {
  sourceDir: string;
  homeDir: string;
  uvPath: string;
  apiPort: number;
  apiHost: string;
  apiServerKey: string;
  autoStartGateway: boolean;
  syncModelCredentials: boolean;
  defaultModel: string;
  modelProvider: string;
  defaults: { sourceDir: string; homeDir: string; uvPath: string };
  envExists?: boolean;
};

type Health = { ok: boolean; status: number; body: string; baseUrl: string };

function api() {
  const s = (window as unknown as { settingsApi?: { hermes?: Record<string, (...args: never[]) => Promise<unknown>> } }).settingsApi;
  return s?.hermes ?? null;
}

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function setStatus(text: string, ok?: boolean): void {
  const node = el("hermes-save-status");
  if (!node) return;
  node.hidden = !text;
  node.textContent = text;
  node.style.color = ok === false ? "#d1495b" : "";
}

function fillForm(s: HermesPublic): void {
  const setVal = (id: string, v: string | number | boolean) => {
    const node = el<HTMLInputElement>(id);
    if (!node) return;
    if (node.type === "checkbox") node.checked = Boolean(v);
    else node.value = String(v ?? "");
  };
  setVal("hermes-source-dir", s.sourceDir || s.defaults?.sourceDir || "");
  setVal("hermes-home-dir", s.homeDir || s.defaults?.homeDir || "");
  setVal("hermes-uv-path", s.uvPath || s.defaults?.uvPath || "");
  setVal("hermes-api-port", s.apiPort ?? 8642);
  setVal("hermes-api-host", s.apiHost || "127.0.0.1");
  setVal("hermes-api-key", s.apiServerKey || "");
  setVal("hermes-auto-start", s.autoStartGateway);
  setVal("hermes-sync-model", s.syncModelCredentials !== false);
  setVal("hermes-default-model", s.defaultModel || "");
  setVal("hermes-model-provider", s.modelProvider || "");
  const hint = el("hermes-env-hint");
  if (hint) {
    hint.textContent = s.envExists
      ? "已检测到 HERMES_HOME/.env"
      : "尚未生成 .env，保存设置时会自动创建";
  }
}

function collectPatch(): Record<string, unknown> {
  const num = Number(el<HTMLInputElement>("hermes-api-port")?.value ?? 8642);
  return {
    sourceDir: el<HTMLInputElement>("hermes-source-dir")?.value.trim() ?? "",
    homeDir: el<HTMLInputElement>("hermes-home-dir")?.value.trim() ?? "",
    uvPath: el<HTMLInputElement>("hermes-uv-path")?.value.trim() ?? "",
    apiPort: Number.isFinite(num) ? num : 8642,
    apiHost: el<HTMLInputElement>("hermes-api-host")?.value.trim() || "127.0.0.1",
    apiServerKey: el<HTMLInputElement>("hermes-api-key")?.value.trim() ?? "",
    autoStartGateway: Boolean(el<HTMLInputElement>("hermes-auto-start")?.checked),
    syncModelCredentials: el<HTMLInputElement>("hermes-sync-model")?.checked !== false,
    defaultModel: el<HTMLInputElement>("hermes-default-model")?.value.trim() ?? "",
    modelProvider: el<HTMLInputElement>("hermes-model-provider")?.value.trim() ?? "",
  };
}

function renderHealth(h: Health | null): void {
  const node = el("hermes-health");
  if (!node) return;
  if (!h) {
    node.textContent = "未检测";
    return;
  }
  node.textContent = h.ok
    ? `在线 ${h.baseUrl} · ${h.body.slice(0, 80)}`
    : `离线/失败 ${h.baseUrl} · ${h.body.slice(0, 120)}`;
  node.style.color = h.ok ? "#0b6b5c" : "#a63a49";
}

let inited = false;

export async function initHermesPanel(): Promise<void> {
  if (inited) return;
  inited = true;
  const bridge = api();
  if (!bridge) {
    setStatus("设置 API 不可用", false);
    return;
  }

  const load = async () => {
    try {
      const res = (await bridge.getSettings()) as { settings: HermesPublic; health: Health };
      fillForm(res.settings);
      renderHealth(res.health);
      setStatus("");
    } catch (err) {
      setStatus(`读取失败: ${String(err)}`, false);
    }
  };

  el("hermes-save-btn")?.addEventListener("click", () => {
    void (async () => {
      try {
        const saved = (await bridge.saveSettings(collectPatch())) as HermesPublic;
        fillForm(saved);
        setStatus("已保存，配置已写入 AI 引擎运行目录", true);
        const health = (await bridge.testHealth()) as Health;
        renderHealth(health);
      } catch (err) {
        setStatus(`保存失败: ${String(err)}`, false);
      }
    })();
  });

  el("hermes-generate-key-btn")?.addEventListener("click", () => {
    void (async () => {
      try {
        const res = (await bridge.generateKey()) as { apiServerKey: string };
        const input = el<HTMLInputElement>("hermes-api-key");
        if (input) input.value = res.apiServerKey;
        setStatus("已生成 API_SERVER_KEY 并写入 .env", true);
      } catch (err) {
        setStatus(`生成失败: ${String(err)}`, false);
      }
    })();
  });

  el("hermes-sync-model-btn")?.addEventListener("click", () => {
    void (async () => {
      try {
        const res = (await bridge.syncModelCredentials()) as { written?: string[]; configPath?: string };
        const keys = res.written?.length ? res.written.join(", ") : "(未找到可同步的模型 Key，请先在「API 设置」填写)";
        setStatus(`同步完成：${keys}`, true);
        await load();
      } catch (err) {
        setStatus(`同步失败: ${String(err)}`, false);
      }
    })();
  });

  el("hermes-health-btn")?.addEventListener("click", () => {
    void (async () => {
      try {
        renderHealth((await bridge.testHealth()) as Health);
      } catch (err) {
        setStatus(`健康检查失败: ${String(err)}`, false);
      }
    })();
  });

  await load();
}
