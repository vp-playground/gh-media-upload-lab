// Injected page overlay: a fake pointer that follows the real Playwright mouse,
// click ripples, keystroke pulses, a caption bar, and title cards.
//
// The pointer is a *follower* of real mouse events, not a separate animation.
// That matters: the driver moves the actual Playwright mouse, so hover states,
// :active, and event handlers all fire exactly as they would for a person, and
// the drawn pointer is guaranteed to sit where the click really lands.
export const OVERLAY_INIT = `
(() => {
  const CURSOR_SVG = \`<svg width="26" height="32" viewBox="0 0 26 32" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 2 L3 23.5 L9.1 17.6 L13 27.5 L16.8 25.9 L12.9 16.1 L21 16.1 Z"
          fill="#ffffff" stroke="#0b0b0b" stroke-width="1.7" stroke-linejoin="round"/></svg>\`;

  function boot() {
    if (document.getElementById("__demo_layer")) return;
    const css = document.createElement("style");
    css.textContent = \`
      html, body, * { cursor: none !important; }
      #__demo_layer { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; }
      #__demo_cursor { position: absolute; left: 0; top: 0; width: 26px; height: 32px;
        transform: translate(-4px, -3px); filter: drop-shadow(0 3px 6px rgba(0,0,0,.55));
        transition: scale .09s ease; will-change: transform; }
      #__demo_cursor.is-down { scale: .84; }
      .__demo_ripple { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px;
        border-radius: 50%; border: 2px solid rgba(88,166,255,.95);
        background: rgba(88,166,255,.28); animation: __demo_r .52s cubic-bezier(.2,.8,.3,1) forwards; }
      @keyframes __demo_r { from { transform: scale(.35); opacity: 1; }
                             to   { transform: scale(4.2); opacity: 0; } }
      #__demo_caption { position: absolute; left: 50%; bottom: 44px; transform: translateX(-50%) translateY(10px);
        max-width: min(80%, 900px); padding: 13px 22px; border-radius: 12px;
        background: rgba(6,9,14,.9); border: 1px solid rgba(255,255,255,.14);
        box-shadow: 0 12px 40px rgba(0,0,0,.6); backdrop-filter: blur(6px);
        color: #f0f6fc; font: 600 20px/1.45 -apple-system, "SF Pro Text", "Noto Sans TC", sans-serif;
        text-align: center; letter-spacing: -0.2px; opacity: 0;
        transition: opacity .22s ease, transform .22s ease; }
      #__demo_caption.is-on { opacity: 1; transform: translateX(-50%) translateY(0); }
      #__demo_card { position: absolute; inset: 0; display: grid; place-content: center; gap: 14px;
        justify-items: center; background: #05070d; opacity: 0; transition: opacity .38s ease; }
      #__demo_card.is-on { opacity: 1; }
      #__demo_card h1 { margin: 0; font: 700 46px/1.1 -apple-system, "SF Pro Display", "Noto Sans TC", sans-serif;
        letter-spacing: -1.2px; color: #f0f6fc; }
      #__demo_card p { margin: 0; font: 400 20px/1.5 -apple-system, "SF Pro Text", "Noto Sans TC", sans-serif; color: #8b949e; }
      #__demo_card .rule { width: 64px; height: 3px; border-radius: 2px;
        background: linear-gradient(90deg,#58a6ff,#a371f7); }

      /* Fake desktop + browser window, so the recording reads as a screen
         capture of a real browser rather than a bare viewport. */
      body.__demo_shelled { overflow: hidden;
        background: radial-gradient(1200px 700px at 20% -10%, #1b2436 0%, #070a10 55%, #04060a 100%) !important; }
      #__demo_shell { position: fixed; inset: 26px; display: flex; flex-direction: column;
        border-radius: 12px; overflow: hidden; background: #0d1117;
        box-shadow: 0 30px 80px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,.07); }
      #__demo_chrome { flex: 0 0 40px; display: flex; align-items: center; gap: 10px;
        padding: 0 14px; background: #21262d; border-bottom: 1px solid rgba(255,255,255,.07); }
      #__demo_chrome .lights { display: flex; gap: 7px; }
      #__demo_chrome .lights i { width: 11px; height: 11px; border-radius: 50%; display: block; }
      #__demo_url { flex: 1; margin: 0 8px; height: 24px; border-radius: 999px;
        background: #0d1117; border: 1px solid rgba(255,255,255,.08); display: flex;
        align-items: center; gap: 7px; padding: 0 12px; color: #8b949e;
        font: 12px/1 -apple-system, "SF Pro Text", sans-serif; }
      #__demo_url b { color: #e6edf3; font-weight: 500; }
      #__demo_content { flex: 1; min-height: 0; position: relative; overflow: hidden; }
      #__demo_content > * { height: 100% !important; }
    \`;
    document.head.appendChild(css);

    if (window.__DEMO_CHROME) {
      const shell = document.createElement("div");
      shell.id = "__demo_shell";
      const bar = document.createElement("div");
      bar.id = "__demo_chrome";
      bar.innerHTML =
        '<span class="lights"><i style="background:#ff5f57"></i>' +
        '<i style="background:#febc2e"></i><i style="background:#28c840"></i></span>' +
        '<div id="__demo_url">\u{1F512} <b>app.pulse.support</b>/inbox</div>';
      const content = document.createElement("div");
      content.id = "__demo_content";
      while (document.body.firstChild) content.appendChild(document.body.firstChild);
      shell.append(bar, content);
      document.body.appendChild(shell);
      document.body.classList.add("__demo_shelled");
    }

    const layer = document.createElement("div");
    layer.id = "__demo_layer";
    layer.innerHTML =
      '<div id="__demo_cursor">' + CURSOR_SVG + '</div>' +
      '<div id="__demo_caption"></div>' +
      '<div id="__demo_card"><div class="rule"></div><h1></h1><p></p></div>';
    document.body.appendChild(layer);

    const cursor = layer.querySelector("#__demo_cursor");
    const caption = layer.querySelector("#__demo_caption");
    const card = layer.querySelector("#__demo_card");

    // Follow the real pointer so the drawn cursor can never drift from the
    // coordinates the driver actually clicks.
    let x = window.innerWidth / 2, y = window.innerHeight / 2;
    const place = () => { cursor.style.translate = x + "px " + y + "px"; };
    place();
    addEventListener("mousemove", (e) => { x = e.clientX; y = e.clientY; place(); }, true);
    addEventListener("mousedown", (e) => {
      cursor.classList.add("is-down");
      const r = document.createElement("div");
      r.className = "__demo_ripple";
      r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px";
      layer.appendChild(r);
      setTimeout(() => r.remove(), 560);
    }, true);
    addEventListener("mouseup", () => cursor.classList.remove("is-down"), true);

    window.__demo = {
      caption(text) {
        if (!text) { caption.classList.remove("is-on"); return; }
        caption.textContent = text;
        caption.classList.add("is-on");
      },
      card(title, sub) {
        card.querySelector("h1").textContent = title || "";
        card.querySelector("p").textContent = sub || "";
        card.classList.add("is-on");
      },
      cardOff() { card.classList.remove("is-on"); },
    };
  }
  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
`;
