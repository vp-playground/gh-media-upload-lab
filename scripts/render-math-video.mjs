// Deterministic HTML/canvas -> MP4 renderer.
//
// The page exposes a pure `window.renderFrame(timeSeconds)`. This script steps
// that function on an exact timeline and pipes each PNG straight into ffmpeg,
// so output is frame-accurate and reproducible: no wall-clock timing, no
// dropped frames, and no dependency on how fast the machine renders.
//
// Runs fully headless. It never touches the foreground desktop.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const FFMPEG = process.env.FFMPEG ?? "ffmpeg";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FPS = Number(process.env.FPS ?? 60);
// Frame-by-frame rendering is CPU-bound: a 2-core CI runner is an order of
// magnitude slower than a laptop, so both the frame count and the encoder
// preset need to be tunable per environment.
const MAX_SECONDS = Number(process.env.MAX_SECONDS ?? 0);
const X264_PRESET = process.env.X264_PRESET ?? "slow";
const WIDTH = 1280;
const HEIGHT = 720;
const outPath = process.argv[2] ?? path.join(root, "out", "math.mp4");

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
});
await page.goto(`file://${path.join(root, "web", "math.html")}`);
const duration = await page.evaluate(() => window.ANIM_DURATION);
const total = Math.round((MAX_SECONDS > 0 ? Math.min(duration, MAX_SECONDS) : duration) * FPS);
console.log(`rendering ${total} frames @ ${FPS}fps (${duration}s) -> ${outPath}`);

const ff = spawn(
  FFMPEG,
  [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
    "-c:v", "libx264", "-preset", X264_PRESET, "-crf", "20",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    outPath,
  ],
  { stdio: ["pipe", "inherit", "inherit"] },
);

const write = (buf) =>
  new Promise((resolve, reject) => {
    if (ff.stdin.write(buf)) return resolve();
    ff.stdin.once("drain", resolve);
    ff.stdin.once("error", reject);
  });

const started = process.hrtime.bigint();
for (let i = 0; i < total; i++) {
  await page.evaluate((t) => window.renderFrame(t), i / FPS);
  await write(await page.screenshot({ type: "png" }));
  if (i % 60 === 0) process.stdout.write(`  frame ${i}/${total}\r`);
}
ff.stdin.end();
await new Promise((resolve, reject) => {
  ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
});
await browser.close();
const secs = Number(process.hrtime.bigint() - started) / 1e9;
console.log(`\ndone in ${secs.toFixed(1)}s -> ${outPath}`);
