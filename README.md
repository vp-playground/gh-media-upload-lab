# gh-media-upload-lab

Two questions, answered with running code instead of blog posts:

1. How do you get an **image or a video into a GitHub issue or PR from a script**, with no
   browser, no clipboard, and no stolen window focus?
2. How do you produce a **web-demo video that looks like real usage** — moving cursor,
   click feedback, subtitles — headlessly?

Everything below was verified against this repository on 2026-08-19. Evidence lives in
[issue #1](https://github.com/vp-playground/gh-media-upload-lab/issues/1) and
[PR #2](https://github.com/vp-playground/gh-media-upload-lab/pull/2).

## 1. Uploading media to issues and pull requests

GitHub's REST API still has no documented attachment endpoint, but the endpoint the web
UI's drag-and-drop is built on accepts an ordinary API bearer token:

```bash
node scripts/upload-attachment.mjs vp-playground/gh-media-upload-lab out/demo.mp4
# -> https://github.com/user-attachments/assets/<uuid>
```

```
POST https://uploads.github.com/user-attachments/assets
  ?name=<filename>&content_type=<mime>&repository_id=<numeric id>
Authorization: Bearer <token>
Accept: application/json
<raw bytes as the body>
-> 201 {"url":"https://github.com/user-attachments/assets/<uuid>"}
```

That URL is the same one drag-and-drop produces, so every GitHub surface renders it
natively. Undocumented means unversioned: pin nothing to it that cannot fall back.

### What the endpoint accepts

Verified by probing content types directly. The endpoint validates the MIME type **and**
that the filename extension matches it.

The whitelist is exactly eight types:

| Content type | Result |
|---|---|
| `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml` | 201 |
| `video/mp4`, `video/webm`, `video/quicktime` | 201 |
| `image/avif`, `image/apng`, `video/x-m4v`, `audio/mpeg`, `audio/wav` | 422 not in allowed list |
| `application/pdf`, `application/zip`, `application/octet-stream` | 422 not in allowed list |
| `text/plain`, `text/markdown`, `text/csv`, `application/json` | 422 not in allowed list |
| `image/jpeg` with a `.png` filename | 422 extension mismatch |

So the token path covers **images and video only**. Everything else is section 1b.

Size ceilings are GitHub's documented attachment limits: 10 MB for images and GIFs, 10 MB
for video on a free plan and 100 MB on a paid plan, 25 MB for everything else.

## 1b. Non-media attachments need a browser session

PDFs, archives, logs, and text files land in a **different store** with a different URL
shape — `https://github.com/user-attachments/files/<id>/<name>` rather than
`/assets/<uuid>` — and there is no token route to it.

`scripts/browser-attach.js` runs in the page context of an open issue or PR and hands the
file to GitHub's own editor as a synthesized `paste` with a real `File`:

```js
await attachFiles([{ name: "evidence.log", type: "", base64: "..." }])
// -> ["[evidence.log](https://github.com/user-attachments/files/31204124/evidence.log)"]
```

Verified this way: `application/pdf`, `application/zip`, and `text/plain`.

Two things that will bite:

- **The declared type must be what a real browser would report for that filename.** A
  `.log` declared as `text/plain` is rejected; the identical bytes with an **empty** type
  succeed, because that is what Chrome reports for an extension the OS mime map does not
  know. The policy step validates name against content type just like the token endpoint.
- **GitHub's new comment box has no `input[type=file]` in the DOM** — it is created on
  demand — so ref-based file-input upload tools find nothing to target. The paste event is
  the reliable seam.

### Why a token cannot do this

Instrumenting `fetch` during a real upload shows a three-step flow:

1. `POST github.com/upload/policies/assets` — multipart `repository_id`, `name`, `size`,
   `content_type`; headers include `github-verified-fetch: true` and a per-page-load
   `x-fetch-nonce`, returning the S3 policy and a numeric id
2. `POST objects-origin.githubusercontent.com/github-production-repository-file-…` — the
   policy fields from step 1, plus `file`
3. `PUT /upload/repository-files/<id>` — `authenticity_token`

Step 1's verified-fetch nonce is issued to a page load, which is the whole point: it is
there to stop exactly this kind of scripted call. `uploads.github.com/user-attachments/files`
does exist and does validate `size`, but returned 404 for every content type tried, with
and without those headers spoofed.

Practical consequence: if a non-media attachment has to be produced unattended, do not
chase this flow. Put the file in a release asset (`gh release upload`, any file type, 2 GB
each) or a repo blob and link to it — it will not preview, but it needs no session.

### How each URL shape renders

Checked through the rendered HTML of a real issue, a real comment, `POST /markdown`, and a
real `README.md`.

| Asset location | Markdown used | Renders as |
|---|---|---|
| `user-attachments` | `![alt](url)` | `<img>` |
| `user-attachments` | bare URL on its own line | native `<video>` player |
| `user-attachments` | `<video src="url" controls>` | native `<video>` player |
| `user-attachments` | `[label](url)` | native `<video>` player |
| Release asset / `raw.githubusercontent.com` | `![alt](url)` | `<img>` |
| Release asset / `raw.githubusercontent.com` | bare URL | plain link, no player |
| Release asset / `raw.githubusercontent.com` | `<video src="url">` | **tag stripped entirely** |

Two consequences worth remembering:

- **Inline video playback has exactly one source.** `<video>` survives the sanitizer only
  when `src` points at a `user-attachments` asset. Committing an MP4 to the repo and
  linking it does not produce a player, in issues or in a README.
- `<video>` **is** allowed in `README.md`, not just in issues. The widely repeated claim
  that GitHub strips video from READMEs is out of date for attachment URLs.

Images have fallbacks that need no undocumented endpoint: a release asset
(`gh release upload`) or a `raw.githubusercontent.com` URL both render as `<img>`.

### Two more properties to design around

- **Attachments are public by URL.** Fetching a canonical `/assets/` URL unauthenticated
  returns `302` to a signed S3 object and then `200` with the bytes, even though the
  rendered page uses short-lived `private-user-images.githubusercontent.com` links. Treat
  an uploaded attachment as published. `/files/` URLs behave slightly differently: they
  404 while still an unposted draft, and become publicly downloadable once referenced from
  posted content.
- **`repository_id` is attribution, not a fence.** An asset uploaded against repo A
  renders in repo B's markdown context. Upload once, embed anywhere you can write.

### Animated GIF, for comparison

Same 35-second walkthrough, 12 fps and 900 px wide as a GIF versus 30 fps and 1280 px wide
as H.264: **4.65 MB vs 948 KB**. Use MP4 unless you specifically need a frame that
autoplays with no click, or a surface outside GitHub that has no player.

## 2. Recording a demo video headlessly

`scripts/record-demo.mjs` drives [`web/demo-app/`](web/demo-app) — a fake support-inbox
product — and records the whole session in headless Chromium. The macOS desktop is never
touched: no window focus, no real pointer movement, no clipboard.

```bash
pnpm demo    # -> out/demo.mp4 + out/demo.vtt
pnpm math    # -> out/math.mp4
```

The parts that make it read as real usage rather than a slideshow:

- **The pointer is a follower, not an animation.** The driver moves the actual Playwright
  mouse; an injected SVG pointer positions itself from real `mousemove` events. Hover
  states, `:active`, and handlers fire exactly as they would for a person, and the drawn
  pointer cannot drift from where the click really lands.
- **Eased, slightly bowed motion.** `easeInOutCubic` over ~60 samples per move, plus a
  small perpendicular bow, so paths are not machine-straight.
- **A beat before every click**, a scale-down on mousedown, and a ripple at the contact
  point.
- **Real typing** via `keyboard.type` with per-character delay, so filtering visibly
  narrows as characters land.
- **Subtitles rendered in the DOM**, which also gives full CSS control, and the same run
  writes `out/demo.vtt` with the real cue timings.
- Playwright records WebM; ffmpeg converts to `yuv420p` H.264 with `+faststart` and trims
  the blank pre-paint lead-in.

`scripts/render-math-video.mjs` is the deterministic variant for pure generated motion:
[`web/math.html`](web/math.html) exposes a pure `window.renderFrame(t)` — no
`requestAnimationFrame`, no `Date` — so the renderer steps an exact timeline and pipes PNGs
straight into ffmpeg. 720 frames of Fourier epicycles at a true 60 fps in ~31 s, and the
same input always produces identical pixels.

Note for CI: `ubuntu-latest` no longer ships ffmpeg, and Playwright's bundled copy is
VP8-only, so h264 output needs `apt-get install ffmpeg`. Both scripts honour `$FFMPEG`.

## 3. Where the local-desktop route stops

Peekaboo 4 is background-first and its limits are explicit rather than accidental.

- **Background text input works.** `peekaboo paste "…" --app TextEdit` inserted text into a
  window that was never focused, via the accessibility path.
- **Background binary paste does not.** `peekaboo paste --file-path shot.png --app TextEdit`
  returned `effect: unverifiable` with "Cmd+V may have pasted; do not retry", and a
  background window capture confirmed nothing arrived. Image and video payloads need
  `--foreground`, which takes focus. This is the reason to prefer the upload endpoint.
- **Background keystrokes cannot target one window.** Adding `--window-title` is refused
  outright: "Background keyboard delivery cannot safely target a specific window." The
  event goes to the app's key window or nowhere.
- **`capture live --video-out` really does write H.264 MP4** of a screen, window, or
  region, in background focus mode, at native 2× scale. It is change-aware sampling
  though: a static 320×240 region for 4 s kept 1 frame and dropped 11. Capped at 180 s and
  15 active fps, with no way to force every frame. Good automation evidence, wrong tool for
  a smooth demo.
- **`capture video`** turns any video into sampled frames plus a contact sheet, which is
  the fastest way for an agent to review a long recording.
- **`browser` needs a human first.** The Chrome DevTools bridge requires the user to enable
  remote debugging at `chrome://inspect/#remote-debugging` and accept a prompt, so it
  cannot be brought up unattended.
- Through MCP, only **one desktop-mutating call per model response** is honoured; further
  mutations are skipped until a fresh `see`.

`web/paste-probe.html` is a standalone page that reports exactly what a `Cmd+V` delivered
(`clipboardData.types`, `.files`, `.items`), which is how to test a paste path against the
same events GitHub's comment box listens for.

## Recommended paths

| Goal | Use |
|---|---|
| Image or video into an issue/PR/README, scripted | `scripts/upload-attachment.mjs` |
| Same from CI | unverified — see the note below |
| PDF, zip, log, or other non-media attachment | `scripts/browser-attach.js` in a logged-in page, or a release asset plus a link |
| Product walkthrough video | `scripts/record-demo.mjs` |
| Generated/mathematical motion | `scripts/render-math-video.mjs` |
| Proof of what a desktop automation did | `peekaboo capture live` |

## Open question: unattended runs

Everything above was verified with a user token from `gh auth token`. Whether the
attachment endpoint also accepts a workflow's built-in `GITHUB_TOKEN` was **not**
established. `.github/workflows/demo-video.yml` is the harness for it, left on
`workflow_dispatch` so it never runs by itself.

Two things learned while trying, worth keeping:

- Do not run `apt-get` after `playwright install --with-deps` in the same job. The
  Playwright step holds the dpkg lock for minutes and the second apt stalled past
  seven. Fetch a static ffmpeg build instead.
- That static build reports `drawtext`, `ass`, and `subtitles` filters, confirmed
  from the runner log. The local Homebrew ffmpeg here has none of them — only
  `drawbox` — which is why captions are rendered in the DOM rather than burned in.
  With a freetype/libass build, `out/demo.vtt` could instead be burned in after the
  fact via `-vf subtitles=demo.vtt`, restyling without re-recording.
- Frame-by-frame rendering is an order of magnitude slower on a 2-core runner than
  on an M-series laptop — 720 frames at `-preset slow` ran past 20 minutes versus
  ~31 s locally. Both scripts take `FPS`, `MAX_SECONDS`, and `X264_PRESET` so the
  cost can be dialled down.

Also note the split by surface: only the browser paths (2 and 3) transfer to CI at
all. Desktop capture and desktop automation need a real macOS session with real
windows, a real pointer, and real app state, none of which a runner has.

## Layout

```
scripts/upload-attachment.mjs   token-auth media upload, prints the asset URL
scripts/browser-attach.js       non-media upload, runs in a logged-in page context
scripts/record-window.sh        window-scoped macOS screen recording
scripts/record-demo.mjs         headless walkthrough recorder (cursor, clicks, captions)
scripts/demo-overlay.mjs        injected pointer / ripple / caption / title-card layer
scripts/render-math-video.mjs   deterministic canvas -> frame-accurate MP4
web/demo-app/                   fake support-inbox product used as the demo subject
web/math.html                   pure renderFrame(t) Fourier-epicycle animation
web/paste-probe.html            reports what a Cmd+V actually delivered
```
