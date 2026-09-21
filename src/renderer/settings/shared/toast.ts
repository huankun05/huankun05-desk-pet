/** 设置页轻量 Toast：自动消失，无需确认 */
export function showToast(message: string, type: "ok" | "err" | "info" = "info", ms = 2800): void {
  let host = document.getElementById("cy-toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "cy-toast-host";
    host.style.cssText =
      "position:fixed;right:20px;bottom:20px;z-index:100000;display:flex;flex-direction:column;gap:8px;align-items:flex-end;pointer-events:none;";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  const bg =
    type === "ok" ? "#0b6b5c" : type === "err" ? "#a63a49" : "#2c2c2e";
  el.style.cssText = `pointer-events:none;max-width:360px;padding:10px 14px;border-radius:10px;background:${bg};color:#fff;font-size:13px;line-height:1.5;box-shadow:0 4px 16px rgba(0,0,0,.18);opacity:0;transform:translateY(8px);transition:opacity .2s,transform .2s;`;
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "translateY(0)";
  });
  window.setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(8px)";
    window.setTimeout(() => el.remove(), 220);
  }, ms);
}
