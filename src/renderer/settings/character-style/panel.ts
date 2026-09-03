// 角色与风格面板逻辑
import { STYLE_DISPLAY_NAMES, type CharacterConfig } from "../../../shared/character-types";
import type { StyleId } from "../../../shared/style-sampling";
import {
  characterStyleList,
  characterStyleAddBtn,
  characterStyleEditorSection,
  characterStyleEditorTitle,
  characterStyleEditName,
  characterStyleEditModelPath,
  characterStyleEditStyle,
  characterStyleCancelBtn,
  characterStyleSaveBtn,
  characterStyleSamplingBtn,
  characterStylePromptBtn,
  characterStyleSaveStatus,
} from "./dom";

interface GeneralSettingsWithCharacters {
  characters?: CharacterConfig[];
  currentCharacterId?: string;
  currentStyleId?: StyleId;
}

interface SettingsApi {
  getGeneral?: () => Promise<GeneralSettingsWithCharacters>;
  saveGeneral?: (config: { characters?: CharacterConfig[]; currentCharacterId?: string; currentStyleId?: StyleId }) => Promise<unknown>;
}

interface ShellApi {
  openSettings?: (section?: string) => void;
}

function settingsApi(): SettingsApi | undefined {
  return (window as typeof window & { settings?: SettingsApi }).settings;
}

function shellApi(): ShellApi | undefined {
  return (window as typeof window & { sidebar?: ShellApi }).sidebar;
}

let editingCharacters: CharacterConfig[] = [];
let editingIndex = -1;

function setStatus(text: string, type: "" | "is-ok" | "is-error" = ""): void {
  if (!characterStyleSaveStatus) return;
  characterStyleSaveStatus.textContent = text;
  characterStyleSaveStatus.className = "save-status" + (type ? " " + type : "");
}

function renderCharacterList(): void {
  if (!characterStyleList) return;
  characterStyleList.innerHTML = "";

  editingCharacters.forEach((char, idx) => {
    const styleName = STYLE_DISPLAY_NAMES[char.styleId] ?? char.styleId;
    const isDefault = char.id === "cyrene";
    const item = document.createElement("div");
    item.className = "character-style-item";
    item.innerHTML = `
      <div class="character-style-item__info">
        <strong>${char.name}</strong>
        <span>${styleName}风格 · ${char.modelPath}</span>
      </div>
      <div class="character-style-item__actions">
        <button type="button" class="ghost-btn" data-edit="${idx}">编辑</button>
        <button type="button" class="ghost-btn is-danger" data-delete="${idx}" ${isDefault ? "disabled title='默认角色不可删除'" : ""}>删除</button>
      </div>
    `;
    characterStyleList.appendChild(item);
  });
}

function openEditor(index: number): void {
  editingIndex = index;
  const char = editingCharacters[index];
  if (characterStyleEditorTitle) {
    characterStyleEditorTitle.textContent = index === -1 ? "新建角色" : "编辑角色";
  }
  if (characterStyleEditName) characterStyleEditName.value = char?.name ?? "";
  if (characterStyleEditModelPath) characterStyleEditModelPath.value = char?.modelPath ?? "";
  if (characterStyleEditStyle) characterStyleEditStyle.value = char?.styleId ?? "default";
  if (characterStyleEditorSection) characterStyleEditorSection.classList.remove("is-hidden");
  if (characterStyleAddBtn) characterStyleAddBtn.classList.add("is-hidden");
}

function closeEditor(): void {
  editingIndex = -1;
  if (characterStyleEditorSection) characterStyleEditorSection.classList.add("is-hidden");
  if (characterStyleAddBtn) characterStyleAddBtn.classList.remove("is-hidden");
}

async function saveEditor(): Promise<void> {
  const name = characterStyleEditName?.value.trim() ?? "";
  const modelPath = characterStyleEditModelPath?.value.trim() ?? "";
  const styleId = (characterStyleEditStyle?.value ?? "default") as StyleId;

  if (!name) { setStatus("请填写角色名称", "is-error"); return; }
  if (!modelPath) { setStatus("请填写模型路径", "is-error"); return; }

  if (editingIndex === -1) {
    const baseId = name.toLowerCase().replace(/[^a-z0-9]/g, "-") || "character";
    let id = baseId;
    let n = 1;
    while (editingCharacters.some((c) => c.id === id)) {
      id = `${baseId}-${n++}`;
    }
    editingCharacters.push({ id, name, modelPath, styleId });
  } else {
    editingCharacters[editingIndex] = {
      ...editingCharacters[editingIndex],
      name,
      modelPath,
      styleId,
    };
  }

  try {
    await settingsApi()?.saveGeneral?.({ characters: editingCharacters });
    setStatus("角色已保存", "is-ok");
    closeEditor();
    renderCharacterList();
  } catch {
    setStatus("保存失败", "is-error");
  }
}

async function loadCharacters(): Promise<void> {
  try {
    const cfg = await settingsApi()?.getGeneral?.();
    editingCharacters = Array.isArray(cfg?.characters) && cfg.characters.length > 0
      ? [...cfg.characters]
      : [{ id: "cyrene", name: "昔涟", modelPath: "cyrene/Cyrene.model3.json", styleId: "default" as StyleId }];
    renderCharacterList();
  } catch {
    setStatus("读取角色列表失败", "is-error");
  }
}

export function initCharacterStylePanel(): void {
  // 新建角色按钮
  characterStyleAddBtn?.addEventListener("click", () => {
    editingIndex = -1;
    openEditor(-1);
  });

  // 取消按钮
  characterStyleCancelBtn?.addEventListener("click", closeEditor);

  // 保存按钮
  characterStyleSaveBtn?.addEventListener("click", () => void saveEditor());

  // 角色列表点击（编辑/删除）
  characterStyleList?.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const editBtn = target.closest("[data-edit]");
    const deleteBtn = target.closest("[data-delete]");
    if (editBtn) {
      openEditor(Number(editBtn.getAttribute("data-edit")));
    } else if (deleteBtn && !deleteBtn.hasAttribute("disabled")) {
      const idx = Number(deleteBtn.getAttribute("data-delete"));
      const char = editingCharacters[idx];
      if (window.confirm(`确定删除角色「${char.name}」？\n删除后不可恢复。`)) {
        editingCharacters.splice(idx, 1);
        settingsApi()?.saveGeneral?.({ characters: editingCharacters })
          .then(() => {
            setStatus("角色已删除", "is-ok");
            renderCharacterList();
          })
          .catch(() => setStatus("删除失败", "is-error"));
      }
    }
  });

  // 自定义风格采样按钮 → 跳转到偏好设置
  characterStyleSamplingBtn?.addEventListener("click", () => {
    shellApi()?.openSettings?.("preferences");
  });

  // 自定义风格 Prompt 按钮 → 跳转到偏好设置
  characterStylePromptBtn?.addEventListener("click", () => {
    shellApi()?.openSettings?.("preferences");
  });

  // 面板显示时加载角色列表
  const observer = new MutationObserver(() => {
    if (characterStyleForm && !characterStyleForm.classList.contains("is-hidden")) {
      void loadCharacters();
      setStatus("等待操作");
    }
  });
  if (characterStyleForm) {
    observer.observe(characterStyleForm, { attributes: true, attributeFilter: ["class"] });
  }
}
