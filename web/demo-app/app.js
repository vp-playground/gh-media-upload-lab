// Fake support-inbox app used as the demo subject. Plain DOM, no build step,
// no network: the recorder loads it from file:// and drives it like a user.
const DATA = [
  { id: 1, cust: "Northwind Retail", sub: "Broadcast campaign stuck in \"sending\" for 40 minutes", time: "2m", tags: ["SLA risk", "VIP"], warn: true,
    thread: [
      { who: "Ellen Ho", role: "Northwind Retail", at: "09:12", text: "Our Lunar New Year broadcast has been stuck at \"sending\" for 40 minutes. 12k recipients queued and nothing has gone out. This goes live at noon." },
      { who: "ViPro", role: "Pulse Support", at: "09:15", agent: true, text: "Looking at the queue now. I can see the batch is accepted but the delivery worker has not picked it up — checking the regional dispatcher." },
    ],
    meta: { Plan: "Enterprise", Region: "asia-east1", "Opened": "2026-08-19 09:12", "First reply": "3m 04s", "SLA target": "15m" } },
  { id: 2, cust: "Kiro Labs", sub: "Webhook signature mismatch after key rotation", time: "18m", tags: ["Integration"], warn: false,
    thread: [{ who: "Sam Idris", role: "Kiro Labs", at: "08:56", text: "We rotated our signing key this morning and every webhook now fails verification." }],
    meta: { Plan: "Growth", Region: "us-central1", Opened: "2026-08-19 08:56", "First reply": "—", "SLA target": "4h" } },
  { id: 3, cust: "Ferro Logistics", sub: "Can we export conversation transcripts as CSV?", time: "1h", tags: ["Question"], warn: false,
    thread: [{ who: "Dana Wu", role: "Ferro Logistics", at: "08:04", text: "Compliance wants monthly transcripts. Is CSV export available on our plan?" }],
    meta: { Plan: "Growth", Region: "asia-east1", Opened: "2026-08-19 08:04", "First reply": "12m", "SLA target": "8h" } },
  { id: 4, cust: "Brightpath Clinic", sub: "Agent seats billed twice in July invoice", time: "3h", tags: ["Billing"], warn: false,
    thread: [{ who: "Ivy Sun", role: "Brightpath Clinic", at: "06:40", text: "July invoice shows 24 seats. We only have 12 active agents." }],
    meta: { Plan: "Starter", Region: "asia-east1", Opened: "2026-08-19 06:40", "First reply": "31m", "SLA target": "8h" } },
  { id: 5, cust: "Volta Energy", sub: "Rich message carousel renders blank on Android", time: "5h", tags: ["Bug"], warn: false,
    thread: [{ who: "Ken Ma", role: "Volta Energy", at: "04:20", text: "Carousel cards show as empty white boxes on Android 14." }],
    meta: { Plan: "Enterprise", Region: "asia-east1", Opened: "2026-08-19 04:20", "First reply": "9m", "SLA target": "15m" } },
];

const listEl = document.getElementById("list");
const detailEl = document.getElementById("detail");
const searchEl = document.getElementById("search");
const scrim = document.getElementById("scrim");
const toast = document.getElementById("toast");
let selected = null;
let pendingAssignee = null;

const tagClass = (t) => (t === "SLA risk" ? "tag sla" : t === "VIP" ? "tag vip" : "tag");

function renderList(filter = "") {
  const q = filter.trim().toLowerCase();
  const rows = DATA.filter((d) =>
    !q || `${d.cust} ${d.sub} ${d.tags.join(" ")}`.toLowerCase().includes(q));
  listEl.innerHTML = rows.map((d) => `
    <div class="row ${selected === d.id ? "is-sel" : ""}" data-id="${d.id}">
      <div class="row-top">
        <span class="dot ${d.warn ? "warn" : ""}"></span>
        <span class="row-cust">${d.cust}</span>
        <span class="row-time">${d.time}</span>
      </div>
      <div class="row-sub">${d.sub}</div>
      <div class="tags">${d.tags.map((t) => `<span class="${tagClass(t)}">${t}</span>`).join("")}</div>
    </div>`).join("") || `<div class="detail-empty" style="height:120px">No matches</div>`;
  listEl.querySelectorAll(".row").forEach((r) =>
    r.addEventListener("click", () => select(Number(r.dataset.id))));
}

function select(id) {
  selected = id;
  const d = DATA.find((x) => x.id === id);
  detailEl.innerHTML = `
    <h2>${d.sub}</h2>
    <div class="detail-meta">${d.cust} · conversation #${1840 + d.id} · ${d.tags.join(" · ")}</div>
    ${d.thread.map((m) => `
      <div class="msg ${m.agent ? "is-agent" : ""}">
        <div class="msg-head"><span class="avatar avatar-sm">${m.who.split(" ").map((w) => w[0]).join("")}</span>
        <b>${m.who}</b> <i style="color:var(--dim);font-style:normal">${m.role}</i><span>${m.at}</span></div>
        <p>${m.text}</p>
      </div>`).join("")}
    <dl class="kv">${Object.entries(d.meta).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
  renderList(searchEl.value);
}

searchEl.addEventListener("input", () => renderList(searchEl.value));

document.getElementById("btn-assign").addEventListener("click", () => {
  if (selected == null) return;
  scrim.classList.add("is-open");
});
document.getElementById("modal-cancel").addEventListener("click", closeModal);
document.getElementById("assignees").addEventListener("click", (e) => {
  const b = e.target.closest(".assignee");
  if (!b) return;
  document.querySelectorAll(".assignee").forEach((x) => x.classList.remove("is-sel"));
  b.classList.add("is-sel");
  pendingAssignee = b.dataset.name;
  document.getElementById("modal-confirm").disabled = false;
});
document.getElementById("modal-confirm").addEventListener("click", () => {
  closeModal();
  showToast(`Assigned to ${pendingAssignee} — SLA timer paused`);
});
function closeModal() { scrim.classList.remove("is-open"); }
function showToast(msg) {
  toast.textContent = `✓ ${msg}`;
  toast.classList.add("is-open");
  setTimeout(() => toast.classList.remove("is-open"), 3200);
}

document.querySelectorAll(".nav-item").forEach((n) =>
  n.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((x) => x.classList.remove("is-active"));
    n.classList.add("is-active");
  }));

renderList();
