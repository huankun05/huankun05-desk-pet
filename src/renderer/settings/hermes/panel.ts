/**
 * 本地 Agent 引擎设置面板
 * 路径自动探测；模型只在「API 设置」维护，这里一键同步。
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
  const setText = (id: string, v: string) => {
    const n = el(id);
    if (n) n.textContent = v || "—";
  };
  setText("hermes-source-dir-view", s.sourceDir || s.defaults?.sourceDir || "");
  setText("hermes-home-dir-view", s.homeDir || s.defaults?.homeDir || "");
  setText("hermes-uv-path-view", s.uvPath || s.defaults?.uvPath || "");
  const port = el<HTMLInputElement>("hermes-api-port");
  if (port) port.value = String(s.apiPort ?? 8642);
  const host = el<HTMLInputElement>("hermes-api-host");
  if (host) host.value = s.apiHost || "127.0.0.1";
  const key = el<HTMLInputElement>("hermes-api-key");
  if (key) key.value = s.apiServerKey || "";
  const sync = el<HTMLInputElement>("hermes-sync-model");
  if (sync) sync.checked = s.syncModelCredentials !== false;
  const auto = el<HTMLInputElement>("hermes-auto-start");
  if (auto) auto.checked = Boolean(s.autoStartGateway);
  const hint = el("hermes-env-hint");
  if (hint) {
    hint.textContent = s.envExists ? "已检测到运行数据目录" : "首次保存时会自动创建运行数据目录";
  }
}

function collectPatch(): Record<string, unknown> {
  const num = Number(el<HTMLInputElement>("hermes-api-port")?.value ?? 8642);
  return {
    apiPort: Number.isFinite(num) ? num : 8642,
    apiHost: el<HTMLInputElement>("hermes-api-host")?.value.trim() || "127.0.0.1",
    apiServerKey: el<HTMLInputElement>("hermes-api-key")?.value.trim() ?? "",
    autoStartGateway: Boolean(el<HTMLInputElement>("hermes-auto-start")?.checked),
    syncModelCredentials: el<HTMLInputElement>("hermes-sync-model")?.checked !== false,
  };
}

function renderHealth(h: Health | null): void {
  const node = el("hermes-health");
  if (!node) return;
  if (!h) {
    node.textContent = "未检测";
    return;
  }
  node.textContent = h.ok ? `在线 ${h.baseUrl}` : `离线 ${h.baseUrl}`;
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
        setStatus("已保存", true);
        renderHealth((await bridge.testHealth()) as Health);
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
        setStatus("已生成访问密钥", true);
      } catch (err) {
        setStatus(`生成失败: ${String(err)}`, false);
      }
    })();
  });

  el("hermes-sync-model-btn")?.addEventListener("click", () => {
    void (async () => {
      try {
        const res = (await bridge.syncModelCredentials()) as { written?: string[] };
        const keys = res.written?.length
          ? res.written.join(", ")
          : "(API 设置里还没有可用的模型 Key)";
        setStatus(`已同步到引擎：${keys}`, true);
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
        setStatus(`检查失败: ${String(err)}`, false);
      }
    })();
  });

  await load();
}
