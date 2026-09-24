/**
 * 本地引擎设置：路径自动探测，界面只管「连得上 / 何时启动 / 模型凭据同步」。
 * 产品取舍：不暴露源码目录、uv、HOME 路径（由主进程 discover* 解析）。
 */

import { showToast } from "../shared/toast";

type Health = { ok: boolean; status: number; body: string; baseUrl: string };
type PublicSettings = {
  syncModelCredentials?: boolean;
  autoStartGateway?: boolean;
  apiHost?: string;
  apiPort?: number;
};

function api() {
  const w = window as unknown as {
    settings?: { hermes?: Record<string, (...args: never[]) => Promise<unknown>> };
    settingsApi?: { hermes?: Record<string, (...args: never[]) => Promise<unknown>> };
  };
  return w.settings?.hermes ?? w.settingsApi?.hermes ?? null;
}

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function setStatus(text: string, ok?: boolean): void {
  const node = el("hermes-save-status");
  if (!node) return;
  node.hidden = !text;
  node.textContent = text;
  node.style.color = ok === false ? "#a63a49" : ok === true ? "#0b6b5c" : "";
}

function setBusy(btn: HTMLButtonElement | null, busy: boolean, busyText: string, idleText: string): void {
  if (!btn) return;
  btn.disabled = busy;
  btn.textContent = busy ? busyText : idleText;
}

function renderHealth(h: Health | null): void {
  const node = el("hermes-health");
  const detail = el("hermes-health-detail");
  if (!node) return;
  if (!h) {
    node.textContent = "未检测";
    node.style.color = "";
    if (detail) detail.textContent = "尚未检查";
    return;
  }
  node.textContent = h.ok ? "已连接" : "未连接";
  node.style.color = h.ok ? "#0b6b5c" : "#a63a49";
  if (detail) {
    const extra = h.body?.trim();
    detail.textContent = h.ok
      ? extra || "网关 /health 正常"
      : extra || "引擎可能未启动，请稍候重试或查看应用日志";
  }
}

function renderEndpoint(s: PublicSettings): void {
  const node = el("hermes-endpoint");
  if (!node) return;
  const host = s.apiHost || "127.0.0.1";
  const port = s.apiPort || 8642;
  node.textContent = `http://${host}:${port}`;
}

let inited = false;

export async function initHermesPanel(): Promise<void> {
  if (inited) return;
  inited = true;
  const bridge = api();
  if (!bridge) {
    setStatus("设置 API 不可用，请重启应用后再试", false);
    showToast("设置 API 不可用", "err");
    return;
  }

  const load = async (): Promise<void> => {
    const res = (await bridge.getSettings()) as {
      settings: PublicSettings;
      health: Health;
    };
    const sync = el<HTMLInputElement>("hermes-sync-model");
    if (sync) sync.checked = res.settings.syncModelCredentials !== false;
    const auto = el<HTMLInputElement>("hermes-auto-start");
    if (auto) auto.checked = res.settings.autoStartGateway !== false;
    renderEndpoint(res.settings);
    renderHealth(res.health);
    setStatus("");
  };

  const checkHealth = async (): Promise<void> => {
    const btn = el<HTMLButtonElement>("hermes-health-btn");
    setBusy(btn, true, "检查中…", "检查健康");
    setStatus("正在检查引擎健康状态…");
    try {
      const h = (await bridge.testHealth()) as Health;
      renderHealth(h);
      if (h.ok) {
        setStatus("引擎在线", true);
        showToast("本地引擎已连接", "ok");
      } else {
        setStatus(h.body || "未连接", false);
        showToast(h.body || "本地引擎未连接", "err");
      }
    } catch (err) {
      setStatus(String(err), false);
      showToast("检查失败：" + String(err), "err");
    } finally {
      setBusy(btn, false, "检查中…", "检查健康");
    }
  };

  el("hermes-health-btn")?.addEventListener("click", () => {
    void checkHealth();
  });

  el("hermes-save-btn")?.addEventListener("click", () => {
    void (async () => {
      const btn = el<HTMLButtonElement>("hermes-save-btn");
      setBusy(btn, true, "保存中…", "保存设置");
      try {
        await bridge.saveSettings({
          syncModelCredentials: el<HTMLInputElement>("hermes-sync-model")?.checked !== false,
          autoStartGateway: el<HTMLInputElement>("hermes-auto-start")?.checked !== false,
        });
        setStatus("已保存", true);
        showToast("本地引擎设置已保存", "ok");
        await load();
      } catch (err) {
        setStatus(String(err), false);
        showToast("保存失败：" + String(err), "err");
      } finally {
        setBusy(btn, false, "保存中…", "保存设置");
      }
    })();
  });

  el("hermes-sync-model-btn")?.addEventListener("click", () => {
    void (async () => {
      const btn = el<HTMLButtonElement>("hermes-sync-model-btn");
      setBusy(btn, true, "同步中…", "立即同步模型服务凭据");
      try {
        const res = (await bridge.syncModelCredentials()) as { written?: string[] };
        const n = res.written?.length ?? 0;
        if (n > 0) {
          setStatus(`已同步 ${n} 项到引擎`, true);
          showToast("模型服务凭据已同步到引擎", "ok");
        } else {
          setStatus("模型服务里还没有可用配置，请先在「模型服务」填写 API Key", false);
          showToast("模型服务里还没有可用配置", "err");
        }
        await load();
      } catch (err) {
        setStatus(String(err), false);
        showToast("同步失败：" + String(err), "err");
      } finally {
        setBusy(btn, false, "同步中…", "立即同步模型服务凭据");
      }
    })();
  });

  try {
    await load();
  } catch (err) {
    setStatus(String(err), false);
  }
}
