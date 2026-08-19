// Headless web-demo recorder.
//
// Drives the fake app with the real Playwright mouse and keyboard while
// Playwright's own screencast records the page, then converts the WebM to an
// MP4 that GitHub can play inline. Nothing touches the macOS foreground: the
// browser is headless, so the user's desktop, focus, and real cursor are free
// for the whole run.
//
// Output: out/demo.mp4 plus out/demo.vtt (caption timings, for accessibility
// or for re-burning subtitles with an ffmpeg build that has libass).
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";
import { OVERLAY_INIT } from "./demo-overlay.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, "out");
const RAW = path.join(OUT, "raw-video");
const SIZE = { width: 1280, height: 800 };
const FPS = 30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

mkdirSync(OUT, { recursive: true });
rmSync(RAW, { recursive: true, force: true });

const browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--font-render-hinting=none"] });
const context = await browser.newContext({
  viewport: SIZE,
  deviceScaleFactor: 1,
  recordVideo: { dir: RAW, size: SIZE },
});
const page = await context.newPage();
// The screencast starts the moment the page exists, so caption timings are
// measured from here and the blank pre-paint lead-in is trimmed at encode time.
const videoT0 = Date.now();
const LEAD_TRIM = 0.5;
await page.addInitScript(OVERLAY_INIT);
await page.goto(`file://${path.join(root, "web", "demo-app", "index.html")}`);
await page.waitForSelector("#__demo_layer");

// ---------------------------------------------------------------- driver state
const cues = [];
let pos = { x: SIZE.width / 2, y: SIZE.height - 120 };
await page.mouse.move(pos.x, pos.y);

/** Move the real mouse along an eased, slightly arced path. */
async function glide(to, ms = 620) {
  const from = { ...pos };
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(3, Math.round(ms / (1000 / 60)));
  // A small perpendicular bow keeps the path from looking machine-straight.
  const bow = Math.min(46, dist * 0.11) * (from.x < to.x ? -1 : 1);
  const nx = -(to.y - from.y) / (dist || 1);
  const ny = (to.x - from.x) / (dist || 1);
  for (let i = 1; i <= steps; i++) {
    const e = easeInOut(i / steps);
    const arc = Math.sin(e * Math.PI) * bow;
    await page.mouse.move(
      from.x + (to.x - from.x) * e + nx * arc,
      from.y + (to.y - from.y) * e + ny * arc,
    );
    await sleep(1000 / 60);
  }
  await page.mouse.move(to.x, to.y);
  pos = to;
}

async function pointAt(selector, { dx = 0, dy = 0, ms = 620 } = {}) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  await glide({ x: box.x + box.width / 2 + dx, y: box.y + box.height / 2 + dy }, ms);
}

async function clickOn(selector, opts = {}) {
  await pointAt(selector, opts);
  await sleep(180);              // a beat of hesitation before committing
  await page.mouse.down();
  await sleep(90);
  await page.mouse.up();
  await sleep(260);
}

/** Show a caption and record its timing for the WebVTT sidecar. */
async function say(text, holdMs = 2400) {
  const offset = videoT0 + LEAD_TRIM * 1000;
  const start = Date.now() - offset;
  await page.evaluate((t) => window.__demo.caption(t), text);
  await sleep(holdMs);
  cues.push({ start: Math.max(0, start), end: Date.now() - offset, text });
}
const clearCaption = () => page.evaluate(() => window.__demo.caption(null));

async function type(selector, text, delay = 62) {
  await page.locator(selector).focus();
  await page.keyboard.type(text, { delay });
}

async function smoothWheel(dy, ms = 620) {
  const steps = Math.max(4, Math.round(ms / 24));
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy / steps);
    await sleep(ms / steps);
  }
}

// ------------------------------------------------------------------- storyboard
await page.evaluate(() => window.__demo.card("Pulse Support Inbox", "Triaging an SLA-risk conversation"));
await sleep(2300);
await page.evaluate(() => window.__demo.cardOff());
await sleep(600);

await say("09:15. Seven open conversations, one of them already burning.", 2600);

await clickOn('.nav-item[data-view="sla"]');
await say("Start from the SLA risk queue instead of the whole inbox.", 2500);

await pointAt("#search", { ms: 520 });
await sleep(120);
await page.mouse.down(); await sleep(80); await page.mouse.up();
await sleep(200);
await type("#search", "broadcast");
await sleep(420);
await say("Search narrows it to the stuck broadcast in one keystroke pass.", 2600);

await clickOn(".row");
await say("Northwind Retail: 12,000 recipients queued, nothing delivered.", 2700);

await smoothWheel(230, 700);
await sleep(300);
await say("Enterprise plan, 15-minute SLA target, first reply already sent.", 2800);
await smoothWheel(-230, 500);

await clearCaption();
await clickOn("#btn-assign");
await say("Hand it to an engineer with room on their queue.", 2400);

await clickOn('.assignee[data-name="Ada Chen"]');
await sleep(240);
await clickOn("#modal-confirm");
await sleep(420);
await say("Assigned, notified, and the SLA timer stops here.", 2800);

await clearCaption();
await sleep(300);
await page.evaluate(() => window.__demo.card("Pulse", "Recorded headlessly with Playwright"));
await sleep(2000);

// ---------------------------------------------------------------------- encode
const video = page.video();
await context.close();
await browser.close();
const webm = await video.path();

const vtt = ["WEBVTT", ""];
const stamp = (ms) => {
  const s = ms / 1000;
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = (s % 60).toFixed(3).padStart(6, "0");
  return `${hh}:${mm}:${ss}`;
};
cues.forEach((c, i) => vtt.push(String(i + 1), `${stamp(c.start)} --> ${stamp(c.end)}`, c.text, ""));
writeFileSync(path.join(OUT, "demo.vtt"), vtt.join("\n"));

const mp4 = path.join(OUT, "demo.mp4");
await new Promise((resolve, reject) => {
  const ff = spawn("ffmpeg", [
    "-y", "-loglevel", "error", "-ss", String(LEAD_TRIM), "-i", webm,
    "-vf", `fps=${FPS},scale=${SIZE.width}:${SIZE.height}:flags=lanczos,format=yuv420p`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "22",
    "-movflags", "+faststart", mp4,
  ], { stdio: "inherit" });
  ff.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg ${c}`))));
});
console.log(`webm: ${webm}`);
console.log(`mp4:  ${mp4}`);
console.log(`vtt:  ${path.join(OUT, "demo.vtt")} (${cues.length} cues)`);
console.log(`raw dir contents: ${readdirSync(RAW).join(", ")}`);
