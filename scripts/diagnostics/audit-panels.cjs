/* 遍历设置窗口所有面板，审计每个面板的 img / CSS 图片加载。 */
const http = require("http");
const WebSocket = require("ws");

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
  const target = targets.find((t) => t.type === "page" && (t.title || "").includes("设置"));
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
  await send("Runtime.enable");
  await send("Page.enable");

  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
  };

  const auditFn = `(() => {
    const broken = [];
    document.querySelectorAll('img').forEach((i) => {
      if (i.complete && i.naturalWidth === 0 && i.src) broken.push(i.src);
      if (i.complete && i.naturalWidth === 0 && !i.src) broken.push('[no-src] ' + i.alt);
    });
    const cssBroken = [];
    document.querySelectorAll('*').forEach((el) => {
      const cs = getComputedStyle(el);
      for (const prop of ['backgroundImage', 'content']) {
        const v = cs[prop] || '';
        if (v.includes('url(') && !v.includes('none') && !v.includes('data:')) {
          const urls = [...v.matchAll(/url\\(["']?([^"')]+)["']?\\)/g)].map((m) => m[1]);
          for (const u of urls) {
            if (u.startsWith('#') || u.startsWith('data:')) continue;
            if (!u.startsWith('http')) continue;
            const m = u.match(/^https?:\\/\\/([^/]+)(\\/.*)$/);
            if (m && m[1] !== location.host) continue;
            if (m) cssBroken.push({ url: m[2], prop });
          }
        }
      }
    });
    return JSON.stringify({ broken: [...new Set(broken)], cssUrls: [...new Set(cssBroken.map((c) => c.url + '#' + c.prop))] });
  })()`;

  // 点击 nav 按钮切换面板
  const navItems = await evalJs(`JSON.stringify([...document.querySelectorAll('.nav-item, [data-nav], .settings-nav__item')].map((n) => ({ text: (n.textContent||'').trim().slice(0,20), hash: n.getAttribute('data-nav') || n.getAttribute('href') })))`);

  const panels = ["api", "advanced", "tokens", "character", "appearance", "preferences", "memory", "tts", "asr", "channels", "tools", "lsp", "skills", "backup", "scheduler"];
  for (const p of panels) {
    await evalJs(`location.hash = '${p}'`);
    await new Promise((r) => setTimeout(r, 1200));
    const audit = await evalJs(auditFn);
    const parsed = audit ? JSON.parse(audit) : null;
    const issues = [];
    if (parsed?.broken?.length) issues.push("IMG: " + parsed.broken.join(" | "));
    if (parsed?.cssUrls?.length) issues.push("CSS: " + parsed.cssUrls.join(" | "));
    console.log(`[${p}] ${issues.length ? "BROKEN -> " + issues.join(" ;; ") : "ok"}`);
  }
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
