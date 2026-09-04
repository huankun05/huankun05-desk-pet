// skills/index.ts —— 技能管理设置面板的渲染进程逻辑。
// 提供技能列表、详情查看、编辑、删除、外部技能安装、备份管理等 UI 功能。

import "./skills.css";

// 声明 window.skills API（由 preload 暴露）
declare global {
  interface Window {
    skills?: {
      list: (options?: { includeArchived?: boolean }) => Promise<any>;
      get: (name: string) => Promise<any>;
      create: (name: string, content: string) => Promise<any>;
      edit: (name: string, content: string) => Promise<any>;
      delete: (name: string) => Promise<any>;
      install: (url: string) => Promise<any>;
      checkUpdate: (name: string) => Promise<any>;
      update: (name: string) => Promise<any>;
      backup: () => Promise<any>;
      listBackups: () => Promise<any>;
      restore: (backupName: string) => Promise<any>;
      deleteBackup: (backupName: string) => Promise<any>;
    };
  }
}

// DOM 元素引用（在 initSkillsPanel 中初始化）
let els: {
  list: HTMLElement | null;
  status: HTMLElement | null;
  installUrl: HTMLInputElement | null;
  installBtn: HTMLButtonElement | null;
  backupBtn: HTMLButtonElement | null;
  refreshBtn: HTMLButtonElement | null;
  modal: HTMLElement | null;
  modalTitle: HTMLElement | null;
  modalClose: HTMLButtonElement | null;
  modalCancel: HTMLButtonElement | null;
  modalSave: HTMLButtonElement | null;
  meta: HTMLElement | null;
  editor: HTMLTextAreaElement | null;
  backupModal: HTMLElement | null;
  backupModalClose: HTMLButtonElement | null;
  backupModalCloseBtn: HTMLButtonElement | null;
  backupList: HTMLElement | null;
} = {
  list: null,
  status: null,
  installUrl: null,
  installBtn: null,
  backupBtn: null,
  refreshBtn: null,
  modal: null,
  modalTitle: null,
  modalClose: null,
  modalCancel: null,
  modalSave: null,
  meta: null,
  editor: null,
  backupModal: null,
  backupModalClose: null,
  backupModalCloseBtn: null,
  backupList: null,
};

// 当前编辑的技能名
let currentEditName: string | null = null;
// 当前是否是创建模式
let isCreateMode = false;

/** 显示状态提示 */
function showStatus(message: string, type: "info" | "success" | "error" = "info"): void {
  if (!els.status) return;
  els.status.textContent = message;
  els.status.className = `skills-status skills-status--${type}`;
  els.status.hidden = false;
  setTimeout(() => {
    if (els.status) els.status.hidden = true;
  }, 5000);
}

/** 转义 HTML */
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/** 格式化来源标签 */
function formatSource(source?: string): string {
  switch (source) {
    case "self-grown": return "自成长";
    case "forked": return "Fork";
    case "umbrella": return "伞技能";
    case "external": return "外部";
    default: return source || "未知";
  }
}

/** 加载并渲染技能列表 */
async function loadSkills(): Promise<void> {
  if (!els.list) return;
  els.list.innerHTML = '<p class="skills-loading">加载中...</p>';

  try {
    const result = await window.skills?.list({ includeArchived: false });
    if (!result?.success) {
      els.list.innerHTML = `<p class="skills-error">加载失败：${escapeHtml(result?.error || "未知错误")}</p>`;
      return;
    }

    const skills = result.skills || [];
    if (skills.length === 0) {
      els.list.innerHTML = '<p class="skills-empty">暂无技能。完成复杂任务后，Agent 会自动沉淀可复用技能。</p>';
      return;
    }

    // 渲染技能卡片列表
    els.list.innerHTML = skills.map((skill: any) => `
      <div class="skill-card" data-name="${escapeHtml(skill.name)}">
        <div class="skill-card__header">
          <span class="skill-card__name">${escapeHtml(skill.name)}</span>
          <span class="skill-card__source skill-card__source--${escapeHtml(skill.source || 'unknown')}">${formatSource(skill.source)}</span>
        </div>
        <p class="skill-card__desc">${escapeHtml(skill.description || "无描述")}</p>
        <div class="skill-card__actions">
          <button class="skill-btn skill-btn--view" data-action="view">查看</button>
          <button class="skill-btn skill-btn--edit" data-action="edit">编辑</button>
          <button class="skill-btn skill-btn--check-update" data-action="check-update">检查更新</button>
          <button class="skill-btn skill-btn--delete" data-action="delete">删除</button>
        </div>
      </div>
    `).join("");

    // 绑定卡片按钮事件
    els.list.querySelectorAll(".skill-card").forEach((card) => {
      const name = card.getAttribute("data-name");
      if (!name) return;
      card.querySelectorAll("button[data-action]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const action = btn.getAttribute("data-action");
          handleSkillAction(name, action);
        });
      });
    });
  } catch (err) {
    els.list.innerHTML = `<p class="skills-error">加载异常：${escapeHtml(String(err))}</p>`;
  }
}

/** 处理技能操作 */
async function handleSkillAction(name: string, action: string | null): Promise<void> {
  switch (action) {
    case "view":
      await viewSkill(name);
      break;
    case "edit":
      await editSkill(name);
      break;
    case "delete":
      await deleteSkill(name);
      break;
    case "check-update":
      await checkSkillUpdate(name);
      break;
  }
}

/** 查看技能详情 */
async function viewSkill(name: string): Promise<void> {
  try {
    const result = await window.skills?.get(name);
    if (!result?.success) {
      showStatus(`查看失败：${result?.error || "未知错误"}`, "error");
      return;
    }
    openModal(name, result.skill, false);
  } catch (err) {
    showStatus(`查看异常：${String(err)}`, "error");
  }
}

/** 编辑技能 */
async function editSkill(name: string): Promise<void> {
  try {
    const result = await window.skills?.get(name);
    if (!result?.success) {
      showStatus(`加载失败：${result?.error || "未知错误"}`, "error");
      return;
    }
    openModal(name, result.skill, true);
  } catch (err) {
    showStatus(`加载异常：${String(err)}`, "error");
  }
}

/** 打开模态框 */
function openModal(name: string, skill: any, editable: boolean): void {
  if (!els.modal || !els.editor || !els.meta || !els.modalTitle || !els.modalSave) return;

  currentEditName = name;
  isCreateMode = false;

  els.modalTitle.textContent = editable ? `编辑技能：${name}` : `技能详情：${name}`;
  els.editor.value = skill.content || "";
  els.editor.readOnly = !editable;
  els.modalSave.style.display = editable ? "inline-block" : "none";

  // 显示元数据
  const metaHtml = `
    <div class="skill-meta-row"><span>名称：</span><strong>${escapeHtml(skill.name || name)}</strong></div>
    <div class="skill-meta-row"><span>描述：</span>${escapeHtml(skill.description || "无")}</div>
    <div class="skill-meta-row"><span>来源：</span>${formatSource(skill.source)}</div>
    ${skill.sourceUrl ? `<div class="skill-meta-row"><span>来源URL：</span><a href="${escapeHtml(skill.sourceUrl)}" target="_blank">${escapeHtml(skill.sourceUrl)}</a></div>` : ""}
    ${skill.protected ? `<div class="skill-meta-row"><span>状态：</span><span class="skill-badge skill-badge--protected">系统内置（受保护）</span></div>` : ""}
  `;
  els.meta.innerHTML = metaHtml;

  els.modal.hidden = false;
}

/** 关闭模态框 */
function closeModal(): void {
  if (els.modal) els.modal.hidden = true;
  currentEditName = null;
  isCreateMode = false;
}

/** 保存技能 */
async function saveSkill(): Promise<void> {
  if (!currentEditName || !els.editor) return;

  try {
    const result = await window.skills?.edit(currentEditName, els.editor.value);
    if (result?.success) {
      showStatus(`技能 '${currentEditName}' 已保存`, "success");
      closeModal();
      await loadSkills();
    } else {
      showStatus(`保存失败：${result?.error || "未知错误"}`, "error");
    }
  } catch (err) {
    showStatus(`保存异常：${String(err)}`, "error");
  }
}

/** 删除技能 */
async function deleteSkill(name: string): Promise<void> {
  if (!confirm(`确定要删除技能 '${name}' 吗？此操作不可撤销（建议先备份）。`)) return;

  try {
    const result = await window.skills?.delete(name);
    if (result?.success) {
      showStatus(`技能 '${name}' 已删除`, "success");
      await loadSkills();
    } else {
      showStatus(`删除失败：${result?.error || "未知错误"}`, "error");
    }
  } catch (err) {
    showStatus(`删除异常：${String(err)}`, "error");
  }
}

/** 检查技能更新 */
async function checkSkillUpdate(name: string): Promise<void> {
  showStatus(`正在检查 '${name}' 的更新...`, "info");
  try {
    const result = await window.skills?.checkUpdate(name);
    if (result?.success) {
      if (result.hasUpdate) {
        if (confirm(`技能 '${name}' 有可用更新，是否更新？（更新前会自动备份）`)) {
          const updateResult = await window.skills?.update(name);
          if (updateResult?.success) {
            showStatus(`技能 '${name}' 已更新到最新版本`, "success");
            await loadSkills();
          } else {
            showStatus(`更新失败：${updateResult?.error || "未知错误"}`, "error");
          }
        }
      } else {
        showStatus(`技能 '${name}' 已是最新版本`, "success");
      }
    } else {
      showStatus(`检查更新失败：${result?.error || "未知错误"}`, "error");
    }
  } catch (err) {
    showStatus(`检查更新异常：${String(err)}`, "error");
  }
}

/** 安装外部技能 */
async function installSkill(): Promise<void> {
  if (!els.installUrl) return;
  const url = els.installUrl.value.trim();
  if (!url) {
    showStatus("请输入技能 URL", "error");
    return;
  }

  showStatus("正在安装技能...", "info");
  try {
    const result = await window.skills?.install(url);
    if (result?.success) {
      showStatus(`技能 '${result.skillName}' 安装成功`, "success");
      els.installUrl.value = "";
      await loadSkills();
    } else {
      showStatus(`安装失败：${result?.error || "未知错误"}`, "error");
    }
  } catch (err) {
    showStatus(`安装异常：${String(err)}`, "error");
  }
}

/** 立即备份 */
async function doBackup(): Promise<void> {
  showStatus("正在备份技能...", "info");
  try {
    const result = await window.skills?.backup();
    if (result?.success) {
      showStatus("备份成功", "success");
    } else {
      showStatus(`备份失败：${result?.error || "未知错误"}`, "error");
    }
  } catch (err) {
    showStatus(`备份异常：${String(err)}`, "error");
  }
}

/** 加载并显示备份列表 */
async function loadBackups(): Promise<void> {
  if (!els.backupList) return;
  els.backupList.innerHTML = '<p class="skills-loading">加载中...</p>';

  try {
    const result = await window.skills?.listBackups();
    if (!result?.success) {
      els.backupList.innerHTML = `<p class="skills-error">加载失败：${escapeHtml(result?.error || "未知错误")}</p>`;
      return;
    }

    const backups = result.backups || [];
    if (backups.length === 0) {
      els.backupList.innerHTML = '<p class="skills-empty">暂无备份。</p>';
      return;
    }

    els.backupList.innerHTML = backups.map((backup: any) => `
      <div class="backup-card" data-name="${escapeHtml(backup.name)}">
        <div class="backup-card__header">
          <span class="backup-card__name">${escapeHtml(backup.name)}</span>
          <span class="backup-card__time">${escapeHtml(new Date(backup.time).toLocaleString())}</span>
        </div>
        <div class="backup-card__meta">
          <span>${backup.skillCount || 0} 个技能</span>
          <span>${(backup.size / 1024).toFixed(1)} KB</span>
        </div>
        <div class="backup-card__actions">
          <button class="skill-btn skill-btn--restore" data-action="restore">恢复</button>
          <button class="skill-btn skill-btn--delete" data-action="delete">删除</button>
        </div>
      </div>
    `).join("");

    // 绑定备份卡片按钮事件
    els.backupList.querySelectorAll(".backup-card").forEach((card) => {
      const name = card.getAttribute("data-name");
      if (!name) return;
      card.querySelectorAll("button[data-action]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const action = btn.getAttribute("data-action");
          if (action === "restore") {
            if (confirm(`确定要从备份 '${name}' 恢复吗？当前技能会被覆盖（恢复前会自动备份当前状态）。`)) {
              const result = await window.skills?.restore(name);
              if (result?.success) {
                showStatus("恢复成功", "success");
                await loadSkills();
                await loadBackups();
              } else {
                showStatus(`恢复失败：${result?.error || "未知错误"}`, "error");
              }
            }
          } else if (action === "delete") {
            if (confirm(`确定要删除备份 '${name}' 吗？`)) {
              const result = await window.skills?.deleteBackup(name);
              if (result?.success) {
                showStatus("备份已删除", "success");
                await loadBackups();
              } else {
                showStatus(`删除失败：${result?.error || "未知错误"}`, "error");
              }
            }
          }
        });
      });
    });
  } catch (err) {
    els.backupList.innerHTML = `<p class="skills-error">加载异常：${escapeHtml(String(err))}</p>`;
  }
}

/** 打开备份管理模态框 */
function openBackupModal(): void {
  if (!els.backupModal) return;
  els.backupModal.hidden = false;
  loadBackups();
}

/** 关闭备份管理模态框 */
function closeBackupModal(): void {
  if (els.backupModal) els.backupModal.hidden = true;
}

// 初始化标志，确保只初始化一次
let initialized = false;

/** 初始化技能管理面板（懒加载，只在用户第一次点击技能管理导航项时调用） */
export function initSkillsPanel(): void {
  if (initialized) {
    console.log("[Skills] 已初始化，跳过");
    return;
  }
  initialized = true;
  console.log("[Skills] 开始初始化技能管理面板");
  // 获取 DOM 元素引用
  els = {
    list: document.getElementById("skills-list"),
    status: document.getElementById("skills-status"),
    installUrl: document.getElementById("skill-install-url") as HTMLInputElement | null,
    installBtn: document.getElementById("skill-install-btn") as HTMLButtonElement | null,
    backupBtn: document.getElementById("skill-backup-btn") as HTMLButtonElement | null,
    refreshBtn: document.getElementById("skill-refresh-btn") as HTMLButtonElement | null,
    modal: document.getElementById("skills-modal"),
    modalTitle: document.getElementById("skills-modal-title"),
    modalClose: document.getElementById("skills-modal-close") as HTMLButtonElement | null,
    modalCancel: document.getElementById("skills-modal-cancel") as HTMLButtonElement | null,
    modalSave: document.getElementById("skills-modal-save") as HTMLButtonElement | null,
    meta: document.getElementById("skills-meta"),
    editor: document.getElementById("skills-editor") as HTMLTextAreaElement | null,
    backupModal: document.getElementById("skills-backup-modal"),
    backupModalClose: document.getElementById("skills-backup-modal-close") as HTMLButtonElement | null,
    backupModalCloseBtn: document.getElementById("skills-backup-modal-close-btn") as HTMLButtonElement | null,
    backupList: document.getElementById("skills-backup-list"),
  };

  // 绑定按钮事件
  els.installBtn?.addEventListener("click", installSkill);
  els.backupBtn?.addEventListener("click", () => {
    doBackup();
    openBackupModal();
  });
  els.refreshBtn?.addEventListener("click", loadSkills);

  // 模态框事件
  els.modalClose?.addEventListener("click", closeModal);
  els.modalCancel?.addEventListener("click", closeModal);
  els.modalSave?.addEventListener("click", saveSkill);

  // 备份模态框事件
  els.backupModalClose?.addEventListener("click", closeBackupModal);
  els.backupModalCloseBtn?.addEventListener("click", closeBackupModal);

  // 点击模态框背景关闭
  els.modal?.addEventListener("click", (e) => {
    if (e.target === els.modal) closeModal();
  });
  els.backupModal?.addEventListener("click", (e) => {
    if (e.target === els.backupModal) closeBackupModal();
  });

  // 初始加载
  loadSkills();

  console.log("[Skills] 技能管理面板已初始化");
}
