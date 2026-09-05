/**
 * LSP 设置面板逻辑
 *
 * 管理 LSP 语言服务器的配置：
 * - 启用/禁用 LSP
 * - 添加/删除/编辑语言服务器
 * - 测试连接
 * - 快速配置常用语言服务器
 * - 保存配置
 */

import { showModal } from "../shared/modal";
import "./lsp.css";

// ── 类型定义 ────────────────────────────────────────────────

interface LspServerConfig {
  enabled: boolean;
  command: string;
  args?: string[];
  workspaceRoot?: string;
  name?: string;
}

interface LspConfig {
  enabled: boolean;
  servers: LspServerConfig[];
}

interface LspConnectionStatus {
  connected: boolean;
  serverName: string;
  error?: string;
  serverVersion?: string;
  testedAt: number;
}

// ── DOM 元素引用 ─────────────────────────────────────────────

const els = {
  enabled: () => document.getElementById("lsp-enabled") as HTMLInputElement | null,
  serversList: () => document.getElementById("lsp-servers-list") as HTMLElement | null,
  addServerBtn: () => document.getElementById("lsp-add-server-btn") as HTMLButtonElement | null,
  saveBtn: () => document.getElementById("lsp-save-btn") as HTMLButtonElement | null,
  saveStatus: () => document.getElementById("lsp-save-status") as HTMLElement | null,
  quickBtns: () => document.querySelectorAll(".lsp-quick-btn") as NodeListOf<HTMLButtonElement>,
};

// ── 状态 ─────────────────────────────────────────────────────

let currentConfig: LspConfig = {
  enabled: false,
  servers: [],
};

// ── API 封装 ─────────────────────────────────────────────────

function getLspApi(): {
  getConfig: () => Promise<LspConfig>;
  saveConfig: (config: LspConfig) => Promise<{ success: boolean }>;
  testConnection: (command: string) => Promise<LspConnectionStatus>;
} | null {
  return (window as unknown as { lsp?: {
    getConfig: () => Promise<LspConfig>;
    saveConfig: (config: LspConfig) => Promise<{ success: boolean }>;
    testConnection: (command: string) => Promise<LspConnectionStatus>;
  } }).lsp ?? null;
}

// ── 渲染服务器列表 ───────────────────────────────────────────

function renderServers(): void {
  const listEl = els.serversList();
  if (!listEl) return;

  if (currentConfig.servers.length === 0) {
    listEl.innerHTML = '<p class="form-hint">暂无语言服务器，点击下方按钮添加。</p>';
    return;
  }

  listEl.innerHTML = currentConfig.servers
    .map((server, index) => `
      <div class="lsp-server-card" data-index="${index}">
        <div class="lsp-server-card__header">
          <input type="text" class="lsp-server-name" value="${escapeHtml(server.name || "")}" placeholder="服务器名称（如：TypeScript）" data-field="name" />
          <label class="toggle-switch">
            <input type="checkbox" class="lsp-server-enabled" ${server.enabled ? "checked" : ""} data-field="enabled" />
            <span class="toggle-switch__slider"></span>
          </label>
          <button type="button" class="btn-danger btn-sm lsp-server-delete" data-index="${index}">删除</button>
        </div>
        <div class="lsp-server-card__body">
          <div class="form-row">
            <label class="form-label">启动命令</label>
            <div class="form-control">
              <input type="text" class="lsp-server-command" value="${escapeHtml(server.command)}" placeholder="如：typescript-language-server --stdio" data-field="command" />
              <span class="form-hint">语言服务器的启动命令，需包含 --stdio 参数。</span>
            </div>
          </div>
          <div class="form-row">
            <label class="form-label">工作区根目录</label>
            <div class="form-control">
              <input type="text" class="lsp-server-workspace" value="${escapeHtml(server.workspaceRoot || "")}" placeholder="可选，默认为当前项目目录" data-field="workspaceRoot" />
            </div>
          </div>
          <div class="form-actions">
            <button type="button" class="btn-secondary btn-sm lsp-server-test" data-index="${index}">测试连接</button>
            <span class="lsp-server-status" data-status-for="${index}"></span>
          </div>
        </div>
      </div>
    `)
    .join("");

  // 绑定事件
  bindServerEvents();
}

function bindServerEvents(): void {
  const listEl = els.serversList();
  if (!listEl) return;

  // 删除按钮
  listEl.querySelectorAll(".lsp-server-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const index = parseInt((e.target as HTMLElement).dataset.index || "-1", 10);
      if (index >= 0 && index < currentConfig.servers.length) {
        currentConfig.servers.splice(index, 1);
        renderServers();
      }
    });
  });

  // 输入字段变化
  listEl.querySelectorAll("input[data-field]").forEach((input) => {
    input.addEventListener("change", (e) => {
      const target = e.target as HTMLInputElement;
      const card = target.closest(".lsp-server-card") as HTMLElement;
      if (!card) return;
      const index = parseInt(card.dataset.index || "-1", 10);
      if (index < 0 || index >= currentConfig.servers.length) return;

      const field = target.dataset.field as keyof LspServerConfig;
      if (field === "enabled") {
        currentConfig.servers[index].enabled = target.checked;
      } else {
        (currentConfig.servers[index] as Record<string, unknown>)[field] = target.value;
      }
    });
  });

  // 测试连接按钮
  listEl.querySelectorAll(".lsp-server-test").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const index = parseInt((e.target as HTMLElement).dataset.index || "-1", 10);
      if (index < 0 || index >= currentConfig.servers.length) return;

      const server = currentConfig.servers[index];
      const statusEl = listEl.querySelector(`[data-status-for="${index}"]`) as HTMLElement;
      if (statusEl) {
        statusEl.textContent = "测试中...";
        statusEl.className = "lsp-server-status lsp-server-status--testing";
      }

      const api = getLspApi();
      if (!api) {
        if (statusEl) {
          statusEl.textContent = "LSP API 不可用";
          statusEl.className = "lsp-server-status lsp-server-status--error";
        }
        return;
      }

      try {
        const result = await api.testConnection(server.command);
        if (statusEl) {
          if (result.connected) {
            statusEl.textContent = `✓ 连接成功（${result.serverName}${result.serverVersion ? " v" + result.serverVersion : ""}）`;
            statusEl.className = "lsp-server-status lsp-server-status--success";
          } else {
            statusEl.textContent = `✗ 连接失败：${result.error}`;
            statusEl.className = "lsp-server-status lsp-server-status--error";
          }
        }
      } catch (error) {
        if (statusEl) {
          statusEl.textContent = `✗ 测试异常：${(error as Error).message}`;
          statusEl.className = "lsp-server-status lsp-server-status--error";
        }
      }
    });
  });
}

// ── 工具函数 ─────────────────────────────────────────────────

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function showSaveStatus(message: string, type: "success" | "error"): void {
  const statusEl = els.saveStatus();
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = `save-status save-status--${type}`;
  statusEl.hidden = false;
  setTimeout(() => {
    statusEl.hidden = true;
  }, 3000);
}

// ── 初始化 ───────────────────────────────────────────────────

export async function initLspPanel(): Promise<void> {
  const api = getLspApi();
  if (!api) {
    console.warn("[lsp-panel] LSP API not available");
    return;
  }

  // 加载配置
  try {
    currentConfig = await api.getConfig();
  } catch (error) {
    console.error("[lsp-panel] Failed to load config:", error);
    currentConfig = { enabled: false, servers: [] };
  }

  // 设置启用状态
  const enabledEl = els.enabled();
  if (enabledEl) {
    enabledEl.checked = currentConfig.enabled;
    enabledEl.addEventListener("change", () => {
      currentConfig.enabled = enabledEl.checked;
    });
  }

  // 渲染服务器列表
  renderServers();

  // 添加服务器按钮
  const addBtn = els.addServerBtn();
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      currentConfig.servers.push({
        enabled: true,
        command: "",
        name: "",
      });
      renderServers();
    });
  }

  // 快速配置按钮
  els.quickBtns().forEach((btn) => {
    btn.addEventListener("click", () => {
      const command = btn.dataset.command || "";
      const name = btn.dataset.name || "";
      currentConfig.servers.push({
        enabled: true,
        command,
        name,
      });
      renderServers();
    });
  });

  // 保存按钮
  const saveBtn = els.saveBtn();
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      try {
        const result = await api.saveConfig(currentConfig);
        if (result.success) {
          showSaveStatus("配置已保存", "success");
        } else {
          showSaveStatus("保存失败", "error");
        }
      } catch (error) {
        showSaveStatus(`保存失败：${(error as Error).message}`, "error");
      }
    });
  }
}

// 副作用导入：模块加载时执行初始化
// 注意：需要在 settings.ts 中导入此模块以触发初始化
