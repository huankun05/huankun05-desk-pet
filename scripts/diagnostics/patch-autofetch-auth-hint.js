const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/src/renderer/settings/settings.ts";
let t = fs.readFileSync(f, "utf8");
const block = `        setModelAutoHint(
          tOr("settings.autoMetaFetchFailed", "服务商接口获取失败，请手动填写模型/上下文") +
            (result.error ? \`：\${String(result.error).slice(0, 80)}\` : ""),
          "err",
        );`;
const neu = `        {
          const errText = String(result.error || "");
          if (/认证失败|401|403|Authentication/i.test(errText)) {
            setModelAutoHint(
              "服务商拒绝认证（API Key 无效或与厂商不匹配）。请到「模型服务」核对厂商与 Key；也可手动填写模型与上下文。",
              "err",
            );
          } else {
            setModelAutoHint(
              tOr("settings.autoMetaFetchFailed", "服务商接口获取失败，请手动填写模型/上下文") +
                (errText ? \`：\${errText.slice(0, 120)}\` : ""),
              "err",
            );
          }
        }`;
if (t.includes(block)) {
  t = t.split(block).join(neu);
  fs.writeFileSync(f, t, "utf8");
  console.log("patched settings autoMeta hint");
} else {
  console.log("block not found, skip");
}

// also update fetch-provider error message already in file - check auth path exists
const fp = "F:/Work/Create/desk_pet/desk-pet/src/main/orchestrator/vendors/fetch-provider-models.ts";
console.log("fetch-provider has maskKey", fs.readFileSync(fp, "utf8").includes("maskKey"));
