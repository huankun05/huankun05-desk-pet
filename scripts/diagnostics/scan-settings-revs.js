const { execSync } = require("child_process");
const cwd = "F:/Work/Create/desk_pet/desk-pet";
const revs = ["fd90c40", "8ed921a", "78a7da1", "7d0851b", "6a49615"];
const fns = [
  "function applyPreset",
  "function editProfile",
  "function loadConfig",
  "function getApiKeyForRequest",
  "function updateEndpointPreview",
  "workFlowAdaptBtn",
  'from "./skills/index"',
  "function bindModelAutoResolve",
  "function switchSection",
];
for (const rev of revs) {
  try {
    const src = execSync(`git show ${rev}:src/renderer/settings/settings.ts`, { cwd, encoding: "utf8", maxBuffer: 10e6 });
    const flags = fns.map((f) => `${f}=${src.includes(f)}`).join(" ");
    console.log(rev, "lines", src.split("\n").length, flags);
  } catch (e) {
    console.log(rev, "ERR", String(e).slice(0, 80));
  }
}
