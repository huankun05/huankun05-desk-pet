/**
 * 技能管理面板逻辑
 * 基于昨天版本的 UI 设计，使用当前项目的 API
 */

import "./skills.css";
import { CustomSelect } from "./components/custom-select/custom-select";

interface SkillInfo {
  id: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  source?: string;
  tools?: string[];
  version?: string;
}

// 筛选器状态
let filterState = {
  source: "all", // all / cyrene-builtin / self-evolving / external
  enabled: "all", // all / enabled / disabled
};

// 所有技能（未筛选）
let allSkills: SkillInfo[] = [];

function getSettingsApi(): any {
  return (window as unknown as { settings?: any }).settings;
}

function setStatus(message: string, type?: string): void {
  const statusEl = document.getElementById("skills-status");
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = "skills-status skills-status--" + (type || "info");
  statusEl.hidden = false;
  setTimeout(() => {
    if (statusEl) statusEl.hidden = true;
  }, 5000);
}

function getSourceType(source: string): "self" | "external" {
  if (source === "self-evolving" || source === "self") return "self";
  return "external";
}

function getSourceLabel(source: string): string {
  if (source === "self-evolving" || source === "self") return "自进化";
  return "外部获取";
}

function filterSkills(): SkillInfo[] {
  return allSkills.filter((skill) => {
    // 按来源筛选
    if (filterState.source !== "all") {
      const skillType = getSourceType(skill.source || "external");
      if (skillType !== filterState.source) return false;
    }
    // 按启用状态筛选
    if (filterState.enabled === "enabled" && skill.enabled === false) return false;
    if (filterState.enabled === "disabled" && skill.enabled !== false) return false;
    return true;
  });
}

function updateFilterCount(): void {
  const countEl = document.getElementById("skills-filter-count");
  if (countEl) {
    const filtered = filterSkills();
    countEl.textContent = `显示 ${filtered.length} / ${allSkills.length} 个技能`;
  }
}

async function loadSkills(): Promise<void> {
  const listEl = document.getElementById("skills-list");
  if (!listEl) return;

  listEl.innerHTML = '<p class="skills-loading">加载中...</p>';

  try {
    const api = getSettingsApi();
    const result = await api?.listSkills?.();
    
    if (Array.isArray(result)) {
      allSkills = result;
    } else if (result?.ok && Array.isArray(result.skills)) {
      allSkills = result.skills;
    } else {
      allSkills = [];
      listEl.innerHTML = `<p class="skills-error">加载失败：${result?.error || "未知错误"}</p>`;
      return;
    }
    
    renderSkills();
  } catch (err) {
    listEl.innerHTML = `<p class="skills-error">加载异常：${String(err)}</p>`;
  }
}

function renderSkills(): void {
  const listEl = document.getElementById("skills-list");
  if (!listEl) return;

  const filtered = filterSkills();
  updateFilterCount();

  if (filtered.length === 0) {
    listEl.innerHTML = '<p class="skills-empty">没有符合筛选条件的技能。</p>';
    return;
  }

  let html = '';
  for (const skill of filtered) {
    const id = skill.id || skill.name || "unknown";
    const name = skill.name || skill.id || "未知技能";
    const description = skill.description || "暂无描述";
    const enabled = skill.enabled !== false;
    const source = skill.source || "external";
    const sourceType = getSourceType(source);
    const sourceLabel = getSourceLabel(source);
    const tools = skill.tools || [];

    let toolsHtml = '';
    if (tools.length > 0) {
      toolsHtml = '<div class="skill-card__tools">';
      for (const tool of tools.slice(0, 4)) {
        toolsHtml += `<span class="skill-card__tool-tag">${tool}</span>`;
      }
      if (tools.length > 4) {
        toolsHtml += `<span class="skill-card__tool-tag">+${tools.length - 4}</span>`;
      }
      toolsHtml += '</div>';
    }

    html += `
      <div class="skill-card skill-card--${sourceType}">
        <div class="skill-card__header">
          <span class="skill-card__name" title="${name}">${name}</span>
          <span class="skill-card__source skill-card__source--${sourceType}">${sourceLabel}</span>
        </div>
        <div class="skill-card__description">${description}</div>
        ${toolsHtml}
        <div class="skill-card__footer">
          <span class="skill-card__id" title="${id}">${id}</span>
          <label class="skill-toggle">
            <input type="checkbox" data-skill-toggle="${id}" ${enabled ? "checked" : ""} />
            <span class="skill-toggle__slider"></span>
          </label>
        </div>
      </div>
    `;
  }

  listEl.innerHTML = html;

  // 绑定开关事件
  listEl.querySelectorAll('input[data-skill-toggle]').forEach((input) => {
    input.addEventListener("change", async (e) => {
      const target = e.target as HTMLInputElement;
      const id = target.getAttribute("data-skill-toggle");
      if (!id) return;
      try {
        const api = getSettingsApi();
        await api?.setSkillEnabled?.(id, target.checked);
        // 更新本地数据
        const skill = allSkills.find((s) => s.id === id);
        if (skill) skill.enabled = target.checked;
        setStatus(`技能 "${id}" 已${target.checked ? "启用" : "禁用"}`, "success");
      } catch (err) {
        setStatus(`操作失败：${String(err)}`, "error");
        target.checked = !target.checked;
      }
    });
  });
}

export function initSkillsPanel(): void {
  try {
  console.log("[Skills] 初始化技能管理面板");

  // 筛选器事件
  const sourceFilter = document.getElementById("skills-filter-source") as HTMLSelectElement | null;
  const enabledFilter = document.getElementById("skills-filter-enabled") as HTMLSelectElement | null;

  sourceFilter?.addEventListener("change", () => {
    filterState.source = sourceFilter.value;
    renderSkills();
  });

  enabledFilter?.addEventListener("change", () => {
    filterState.enabled = enabledFilter.value;
    renderSkills();
  });

  // 刷新按钮
  const refreshBtn = document.getElementById("skill-refresh-btn");
  refreshBtn?.addEventListener("click", () => {
    void loadSkills();
  });

  // 重新扫描按钮
  const rescanBtn = document.getElementById("skill-rescan-btn");
  rescanBtn?.addEventListener("click", async () => {
    try {
      setStatus("正在重新扫描技能目录...");
      const api = getSettingsApi();
      await api?.rescanSkills?.();
      setStatus("重新扫描完成", "success");
      await loadSkills();
    } catch (err) {
      setStatus(`重新扫描失败：${String(err)}`, "error");
    }
  });

  // 应用自定义下拉栏样式
  try {
    const selects = document.querySelectorAll("#skills-panel select");
    selects.forEach((selectEl) => {
      try {
        const select = selectEl as HTMLSelectElement;
        // 从原生 select 中提取选项
        const options: { value: string; label: string }[] = [];
        select.querySelectorAll("option").forEach((opt) => {
          options.push({ value: opt.value, label: opt.textContent || opt.value });
        });
        // 创建 CustomSelect 配置
        const customSelect = new CustomSelect({
          id: select.id + "-custom",
          options,
          value: select.value,
          onChange: (value: string) => {
            select.value = value;
            select.dispatchEvent(new Event("change"));
          },
        });
        // 替换原生 select
        select.parentNode?.replaceChild(customSelect.getElement(), select);
      } catch (e) {
        console.log("[Skills] 下拉栏样式应用失败:", e);
      }
    });
  } catch (e) {
    console.log("[Skills] CustomSelect 不可用，使用原生下拉栏:", e);
  }

  // 初始加载
  void loadSkills();
  } catch (e) {
    console.error("[Skills] 初始化失败:", e);
  }
}
