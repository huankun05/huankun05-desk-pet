import { Popover } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "../../../i18n";
import { normalizeStyleId, type StyleId } from "../../../../../shared/style-sampling";
import { STYLE_DISPLAY_NAMES, type CharacterConfig } from "../../../../../shared/character-types";
import gentleIconUrl from "../../../assets/status-moods/温柔.png?url";
import livelyIconUrl from "../../../assets/status-moods/元气.png?url";
import healingIconUrl from "../../../assets/status-moods/治愈.png?url";
import focusedIconUrl from "../../../assets/status-moods/知性.png?url";
import sweetIconUrl from "../../../assets/status-moods/撒娇.png?url";
import customIconUrl from "../../../assets/status-moods/自定义.png?url";

// 风格 ID 到头像的映射，角色头像用其绑定风格的头像
const STYLE_ICON_BY_ID: Record<StyleId, string> = {
  default: gentleIconUrl,
  lively: livelyIconUrl,
  healing: healingIconUrl,
  focused: focusedIconUrl,
  sweet: sweetIconUrl,
  custom: customIconUrl,
};

interface GeneralSettingsWithCharacters {
  characters?: CharacterConfig[];
  currentCharacterId?: string;
  currentStyleId?: StyleId;
}

interface StyleSettingsApi {
  getGeneral?: () => Promise<GeneralSettingsWithCharacters>;
  saveGeneral?: (config: { currentCharacterId?: string; currentStyleId?: StyleId }) => Promise<unknown>;
}

function styleSettingsApi(): StyleSettingsApi | undefined {
  return (window as typeof window & { settings?: StyleSettingsApi }).settings;
}

function ChevronIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>;
}

export function StyleControl() {
  const { t } = useTranslation();
  const [characters, setCharacters] = useState<CharacterConfig[]>([]);
  const [currentCharacterId, setCurrentCharacterId] = useState<string>("cyrene");
  const [currentStyleId, setCurrentStyleId] = useState<StyleId>("default");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void styleSettingsApi()?.getGeneral?.().then((settings) => {
      const chars = Array.isArray(settings.characters) && settings.characters.length > 0
        ? settings.characters
        : [{ id: "cyrene", name: "昔涟", modelPath: "cyrene/Cyrene.model3.json", styleId: "default" as StyleId }];
      setCharacters(chars);
      const charId = settings.currentCharacterId ?? chars[0].id;
      setCurrentCharacterId(charId);
      // 当前风格：优先用当前角色绑定的风格，其次用 settings 里的 currentStyleId
      const currentChar = chars.find((c) => c.id === charId) ?? chars[0];
      const styleId = normalizeStyleId(currentChar?.styleId ?? settings.currentStyleId);
      setCurrentStyleId(styleId);
    });
  }, []);

  const currentChar = characters.find((c) => c.id === currentCharacterId) ?? characters[0];
  const currentStyleName = STYLE_DISPLAY_NAMES[currentStyleId] ?? currentStyleId;

  async function selectCharacter(character: CharacterConfig) {
    setCurrentCharacterId(character.id);
    setCurrentStyleId(character.styleId);
    setOpen(false);
    try {
      await styleSettingsApi()?.saveGeneral?.({
        currentCharacterId: character.id,
        currentStyleId: character.styleId,
      });
    } catch {
      // 回滚
      setCurrentCharacterId(currentCharacterId);
      setCurrentStyleId(currentStyleId);
    }
  }

  async function selectCustomStyle() {
    setCurrentStyleId("custom");
    setOpen(false);
    try {
      await styleSettingsApi()?.saveGeneral?.({ currentStyleId: "custom" });
    } catch {
      setCurrentStyleId(currentStyleId);
    }
  }

  return (
    <Popover
      trigger="click"
      placement="topRight"
      open={open}
      onOpenChange={setOpen}
      overlayClassName="cy-style-popover"
      content={
        <div className="cy-style-panel">
          <strong>{t("style.panelTitle")}</strong>
          <div className="cy-style-panel__options">
            {characters.map((char) => {
              const styleName = STYLE_DISPLAY_NAMES[char.styleId] ?? char.styleId;
              const isActive = char.id === currentCharacterId && currentStyleId !== "custom";
              return (
                <button
                  type="button"
                  key={char.id}
                  className={`cy-style-panel__option ${isActive ? "is-active" : ""}`}
                  onClick={() => void selectCharacter(char)}
                >
                  <img className="cy-style-icon" src={STYLE_ICON_BY_ID[char.styleId]} alt="" />
                  <span>{char.name} · {styleName}</span>
                </button>
              );
            })}
            <div className="cy-style-panel__divider" />
            <button
              type="button"
              className={`cy-style-panel__option ${currentStyleId === "custom" ? "is-active" : ""}`}
              onClick={() => void selectCustomStyle()}
            >
              <img className="cy-style-icon" src={customIconUrl} alt="" />
              <span>{t("style.optionCustom")}</span>
            </button>
          </div>
        </div>
      }
    >
      <button type="button" className="cy-composer__agent-button cy-style-control">
        <img className="cy-style-icon" src={STYLE_ICON_BY_ID[currentStyleId]} alt="" />
        <span>{currentChar?.name ?? "角色"} · {currentStyleName}</span>
        <ChevronIcon />
      </button>
    </Popover>
  );
}
