/**
 * AI 引擎设置：路径由应用内部处理，界面只管理连接与模型同步。
 */

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

function renderHealth(h: Health | null): void {
  const node = el("hermes-health");
  if (!node) return;
  if (!h) {
    node.textContent = "未检测";
    return;
  }
  node.textContent = h.ok ? "已连接" : "未连接（引擎可能未随应用启动）";
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
      const res = (await bridge.getSettings()) as {
        settings: { syncModelCredentials?: boolean; autoStartGateway?: boolean };
        health: Health;
      };
      const sync = el<HTMLInputElement>("hermes-sync-model");
      if (sync) sync.checked = res.settings.syncModelCredentials !== false;
      const auto = el<HTMLInputElement>("hermes-auto-start");
      if (auto) auto.checked = res.settings.autoStartGateway !== false;
      renderHealth(res.health);
      setStatus("");
    } catch (err) {
      setStatus(String(err), false);
    }
  };

  el("hermes-save-btn")?.addEventListener("click", () => {
    void (async () => {
      try {
        await bridge.saveSettings({
          syncModelCredentials: el<HTMLInputElement>("hermes-sync-model")?.checked !== false,
          autoStartGateway: el<HTMLInputElement>("hermes-auto-start")?.checked !== false,
        });
        setStatus("已保存", true);
      } catch (err) {
        setStatus(String(err), false);
      }
    })();
  });

  el("hermes-sync-model-btn")?.addEventListener("click", () => {
    void (async () => {
      try {
        const res = (await bridge.syncModelCredentials()) as { written?: string[] };
        setStatus(res.written?.length ? "模型配置已同步到引擎" : "模型服务里还没有可用配置", true);
        await load();
      } catch (err) {
        setStatus(String(err), false);
      }
    })();
  });

  el("hermes-health-btn")?.addEventListener("click", () => {
    void (async () => {
      try {
        renderHealth((await bridge.testHealth()) as Health);
      } catch (err) {
        setStatus(String(err), false);
      }
    })();
  });

  await load();
}
