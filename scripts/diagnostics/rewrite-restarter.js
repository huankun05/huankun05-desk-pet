const fs = require("fs");
const f = "F:/Work/Create/desk_pet/desk-pet/src/main/services/appRestart.ts";
let t = fs.readFileSync(f, "utf8");
const s = t.indexOf("function spawnDevSessionRestarter");
const e = t.indexOf("export function restartApp");
if (s < 0 || e < 0) {
  console.log("markers", s, e);
  process.exit(1);
}

const neu = `function spawnDevSessionRestarter(): void {
  const projectRoot = resolve(app.getAppPath());
  const pid = process.pid;
  const tempDir = app.getPath("temp");
  const logFile = join(tempDir, "cyrene-dev-restart.log");
  const scriptPath = join(tempDir, "cyrene-dev-restart-" + pid + ".js");
  const systemNode = "E:/software/Nodejs/node.exe";
  const npmCli = "E:/software/Nodejs/node_modules/npm/bin/npm-cli.js";
  const maxMs = RESTARTER_MAX_TRIES * 1000;

  const lines = [
    "const { spawn } = require('child_process');",
    "const fs = require('fs');",
    "const net = require('net');",
    "const logFile = " + JSON.stringify(logFile) + ";",
    "const projectRoot = " + JSON.stringify(projectRoot) + ";",
    "const parentPid = " + pid + ";",
    "const systemNode = " + JSON.stringify(systemNode) + ";",
    "const npmCli = " + JSON.stringify(npmCli) + ";",
    "const deadline = Date.now() + " + maxMs + ";",
    "function logLine(s){ try { fs.appendFileSync(logFile, s + String.fromCharCode(10)); } catch (e) {} }",
    "function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }",
    "function alive(p){ try { process.kill(p, 0); return true; } catch (e) { return false; } }",
    "function portFree(port){ return new Promise(ok => { const s = net.connect({port: port, host: '127.0.0.1'}, () => { s.destroy(); ok(false); }); s.on('error', () => ok(true)); setTimeout(() => { try { s.destroy(); } catch (e) {} ok(true); }, 200); }); }",
    "(async () => {",
    "  logLine('===== restarter start =====');",
    "  while (alive(parentPid) && Date.now() < deadline) await sleep(250);",
    "  logLine('parent gone');",
    "  try { fs.rmSync(projectRoot + '/dist/main/.vite-dev-url.json', { force: true }); } catch (e) {}",
    "  const portDeadline = Date.now() + 8000;",
    "  while (!(await portFree(5174)) && Date.now() < portDeadline) await sleep(200);",
    "  await sleep(400);",
    "  logLine('spawn npm run dev');",
    "  const out = fs.openSync(logFile, 'a');",
    "  const child = spawn(systemNode, [npmCli, 'run', 'dev'], { cwd: projectRoot, detached: true, stdio: ['ignore', out, out], windowsHide: true });",
    "  child.unref();",
    "  logLine('npm run dev pid=' + child.pid);",
    "  process.exit(0);",
    "})();",
  ];

  writeFileSync(scriptPath, lines.join("\n"), "utf8");
  const child = spawn(systemNode, [scriptPath], {
    cwd: projectRoot,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  safeLog("restarter scheduled (node windowsHide)", scriptPath);
}

`;

t = t.slice(0, s) + neu + t.slice(e);
fs.writeFileSync(f, t, "utf8");
console.log("restarter rewritten", t.includes("portFree(5174)"));
