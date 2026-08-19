#!/usr/bin/env node
// Upload a local file as a GitHub issue/PR/discussion attachment and print the
// resulting https://github.com/user-attachments/assets/<uuid> URL.
//
// Uses the undocumented uploads.github.com endpoint that GitHub's own web UI
// drag-and-drop is built on. It accepts a normal API bearer token, so the whole
// flow is headless: no browser, no clipboard, no window focus.
//
//   node scripts/upload-attachment.mjs <owner/repo> <file> [--markdown]
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const MIME = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
  ".pdf": "application/pdf", ".zip": "application/zip",
  ".txt": "text/plain", ".log": "text/plain", ".json": "application/json",
  ".csv": "text/csv", ".patch": "text/plain",
};

const [repoArg, fileArg, ...rest] = process.argv.slice(2);
if (!repoArg || !fileArg) {
  console.error("usage: upload-attachment.mjs <owner/repo> <file> [--markdown]");
  process.exit(2);
}

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();
const token = process.env.GITHUB_TOKEN || sh("gh", ["auth", "token"]);
const repositoryId = sh("gh", ["api", `repos/${repoArg}`, "--jq", ".id"]);

const name = path.basename(fileArg);
const ext = path.extname(name).toLowerCase();
const contentType = process.env.CONTENT_TYPE || MIME[ext] || "application/octet-stream";
const bytes = readFileSync(fileArg);
const mb = (statSync(fileArg).size / 1024 / 1024).toFixed(2);

const url = new URL("https://uploads.github.com/user-attachments/assets");
url.searchParams.set("name", name);
url.searchParams.set("content_type", contentType);
url.searchParams.set("repository_id", repositoryId);

const res = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": contentType,
  },
  body: bytes,
});
const text = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status} ${res.statusText} (${mb} MB, ${contentType})\n${text}`);
  process.exit(1);
}
const { url: assetUrl } = JSON.parse(text);
if (rest.includes("--markdown")) {
  // Images need markdown image syntax; video/audio render from a bare URL on
  // its own line, and anything else renders as a download link.
  const isImage = contentType.startsWith("image/");
  console.log(isImage ? `![${name}](${assetUrl})` : assetUrl);
} else {
  console.log(assetUrl);
}
console.error(`uploaded ${name} (${mb} MB, ${contentType})`);
