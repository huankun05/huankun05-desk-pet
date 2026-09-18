/* 截图指定窗口。用法：node scripts/cdp-shot.cjs <titleKeyword> <outPath> */
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");

const keyword = process.argv[2] || "设置";
const out = process.argv[3] || "shot.png";

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

(async () => {
  const targets = await getJson("http://127.0.0.1:9223/json");
  const target = targets.find((t) => t.type === "page" && (t.title || "").includes(keyword));
  if (!target) { console.error("target not found"); process.exit(1); }
  const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 });
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const mid = ++id;
      pending.set(mid, resolve);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  await new Promise((r) => ws.on("open", r));
  await send("Page.enable");
  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(out, Buffer.from(shot.result.data, "base64"));
  console.log("saved", out);
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
