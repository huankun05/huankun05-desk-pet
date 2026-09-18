/* 审计渲染窗口的图片加载：img naturalWidth=0 + 失败的 Network 请求。
   用法：node scripts/audit-broken-images.cjs <titleKeyword>
   依赖：ws（项目 devDependencies） */
const http = require("http");
const WebSocket = require("ws");

const keyword = process.argv[2] || "设置";
const port = 9223;

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
  const targets = await getJson(`http://127.0.0.1:${port}/json`);
  const target = targets.find((t) => t.type === "page" && (t.title || "").includes(keyword));
  if (!target) {
    console.error("target not found. pages:", targets.map((t) => t.title).join(" | "));
    process.exit(1);
  }
  console.log("target:", target.title, target.url);

  const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
  let id = 0;
  const pending = new Map();
  const failed = [];
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const mid = ++id;
      pending.set(mid, resolve);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
    if (msg.method === "Network.responseReceived") {
      const r = msg.params.response;
      if (r.status >= 400 && /image|svg|png|jpg|webp|gif|ico|avif/i.test(r.mimeType || "") && msg.params.type === "Image") {
        failed.push({ url: r.url, status: r.status });
      }
    }
    if (msg.method === "Network.loadingFailed") {
      const p = msg.params;
      if (p.type === "Image" && p.errorText && p.errorText !== "net::ERR_ABORTED") {
        failed.push({ url: p.requestId, error: p.errorText });
      }
    }
  });

  await new Promise((resolve) => ws.on("open", resolve));
  await send("Network.enable");
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.reload", { ignoreCache: true });
  await new Promise((r) => setTimeout(r, 4500));

  const evalRes = await send("Runtime.evaluate", {
    expression: `(() => {
      const broken = [];
      document.querySelectorAll('img').forEach((i) => {
        if (i.complete && i.naturalWidth === 0) broken.push({ src: i.src, alt: i.alt, cls: i.className });
      });
      const cssUrls = new Set();
      document.querySelectorAll('*').forEach((el) => {
        const cs = getComputedStyle(el);
        for (const prop of ['backgroundImage', 'content', 'maskImage', 'borderImageSource', 'listStyleImage']) {
          const v = cs[prop] || '';
          const m = v.match(/url\\(["']?([^"')]+)["']?\\)/g);
          if (m) m.forEach((x) => cssUrls.add(x));
        }
      });
      return JSON.stringify({ broken, cssUrls: [...cssUrls], brokenCount: broken.length });
    })()`,
    returnByValue: true,
  });

  const value = evalRes.result?.result?.value;
  console.log("Eval:", value ? JSON.stringify(JSON.parse(value), null, 2).slice(0, 6000) : "(no value)");
  console.log("Failed image requests:", JSON.stringify(failed, null, 2));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
