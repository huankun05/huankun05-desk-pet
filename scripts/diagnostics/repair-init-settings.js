const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/settings.ts";
let t = fs.readFileSync(f, "utf8");
const bad = `  });
}
 } catch (e) { console.error("[Settings] bind", e); } // idempotent

  try { bindModelAutoResolve(); } catch (e) { console.error("[Settings] bind", e); } // idempotent

  try { bindModelAutoResolve(); } catch (e) { console.error("[Settings] bind model ui", e); } // idempotent

  initThemeSwitcher();
  initCustomSelects();
  initPasswordToggles();
  // 语言跟随通用设置；加载完成后刷新静态文案与当前标题栏
  void initSettingsI18n().then(() => {
    applySettingsI18n();
    switchSection(currentSection);
  });
}`;
const good = `  });
}

bindModelAutoResolve();

function initSettingsPage(): void {
  try {
    bindModelAutoResolve();
  } catch (e) {
    console.error("[Settings] bind", e);
  }
  initThemeSwitcher();
  initCustomSelects();
  initPasswordToggles();
  void initSettingsI18n().then(() => {
    applySettingsI18n();
    switchSection(currentSection);
  });
}`;
if (t.includes(bad)) {
  t = t.replace(bad, good);
  fs.writeFileSync(f, t, "utf8");
  console.log("repaired initSettingsPage");
} else {
  // fallback: line surgery
  const lines = t.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.includes("} catch (e) { console.error(\"[Settings] bind\")"));
  console.log("fallback idx", idx);
  if (idx > 0) {
    const splice = [
      "});",
      "}",
      "",
      "bindModelAutoResolve();",
      "",
      "function initSettingsPage(): void {",
      "  try {",
      "    bindModelAutoResolve();",
      "  } catch (e) {",
      "    console.error(\"[Settings] bind\", e);",
      "  }",
      "  initThemeSwitcher();",
      "  initCustomSelects();",
      "  initPasswordToggles();",
      "  void initSettingsI18n().then(() => {",
      "    applySettingsI18n();",
      "    switchSection(currentSection);",
      "  });",
      "}",
    ];
    // find start: previous "  });" before idx
    const start = idx - 1;
    const end = lines.findIndex((l, i) => i > idx && l.trim() === "}" && lines[i + 1] && lines[i + 1].startsWith("if (document.readyState"));
    console.log("start end", start, end);
    if (end > start) {
      const next = [...lines.slice(0, start), ...splice, ...lines.slice(end)];
      fs.writeFileSync(f, next.join("\n"), "utf8");
      console.log("spliced");
    }
  }
}
