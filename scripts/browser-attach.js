// Attach a NON-MEDIA file (pdf, zip, log, txt, docx, …) to a GitHub issue or PR
// comment from inside the page.
//
// Why this exists: the token endpoint at uploads.github.com only accepts eight
// media content types. Everything else has to go through GitHub's own web upload
// flow, and that flow is gated on a `github-verified-fetch: true` header plus a
// per-page-load `x-fetch-nonce`, so a bearer token cannot stand in for a session.
// Driving the page is the only route.
//
// The flow GitHub runs, captured by instrumenting fetch on a real upload:
//   1. POST github.com/upload/policies/assets   multipart: repository_id, name,
//      size, content_type -> returns the S3 policy plus a numeric asset id
//   2. POST objects-origin.githubusercontent.com/github-production-repository-file-…
//      the policy fields from step 1, plus `file`
//   3. PUT /upload/repository-files/<id>        authenticity_token
// Rather than reimplement that (the nonce makes it fragile), this hands the file
// to the editor as a synthesized paste and lets GitHub's own code do the work.
//
// Run in the page context of an open issue/PR with a logged-in session — via
// Chrome MCP javascript_tool, Playwright `page.evaluate` on a logged-in profile,
// or the DevTools console.
//
//   await attachFiles([{ name: "evidence.log", type: "", base64: "..." }])
//   -> ["[evidence.log](https://github.com/user-attachments/files/<id>/evidence.log)"]
//
// `type` MUST be what a real browser would report for that filename. For
// extensions the OS mime map does not know, that is the EMPTY STRING: a `.log`
// declared as `text/plain` is rejected by the policy step, while the same bytes
// with an empty type succeed.
async function attachFiles(files, { timeoutMs = 20000 } = {}) {
  const editor =
    document.querySelector('textarea[placeholder*="Markdown"]') ||
    document.querySelector('textarea[name="comment[body]"]') ||
    document.querySelector("textarea");
  if (!editor) throw new Error("no comment textarea on this page");

  const clear = () => {
    editor.focus();
    editor.setSelectionRange(0, editor.value.length);
    document.execCommand("insertText", false, "");
  };

  const out = [];
  for (const { name, type, base64 } of files) {
    clear();
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    // An empty `type` must stay empty, so only pass the option when set.
    dt.items.add(new File([bytes], name, type ? { type } : {}));
    editor.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
    );

    // GitHub writes a placeholder, then swaps in the markdown link on success or
    // an HTML comment on failure. Poll for whichever lands.
    const deadline = Date.now() + timeoutMs;
    let settled = null;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
      const v = editor.value;
      if (/^\[.*\]\(https:\/\/github\.com\/user-attachments\//m.test(v)) { settled = v.trim(); break; }
      if (/Failed to upload/.test(v)) { settled = null; break; }
    }
    clear();
    if (!settled) throw new Error(`upload failed for ${name} (check the declared content type)`);
    out.push(settled);
  }
  return out;
}
