// The popup: Today, Your numbers, What's new, the three tools (Andrew, 23 Nov, mockup approved).
// It reads one thing, /api/ext/home, with their own sign-in, and only while it is open. Nothing runs in the background for it.
const SITE = "https://www.militaryvoices.ai";
const ZOOM_NEVER = "mvZoomNever";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const open = (url) => { chrome.tabs.create({ url: /^https?:/.test(url) ? url : SITE + url }); window.close(); };

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-url],[data-tool]");
  if (!el) return;
  if (el.dataset.url) return open(el.dataset.url);
  // The answer is drawn on the page itself, so the popup gets out of the way at once.
  chrome.runtime.sendMessage({ type: el.dataset.tool }, () => void chrome.runtime.lastError);
  setTimeout(() => window.close(), 80);
});

// ---- Today ----------------------------------------------------------------------------------------------------------
let tick = null;
function dayLabel(ms) {
  const d = new Date(ms), now = new Date();
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, now)) return "Today";
  const tmr = new Date(now); tmr.setDate(now.getDate() + 1);
  if (same(d, tmr)) return "Tomorrow";
  if (ms - Date.now() < 6 * 86400000) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function countdown(start, end) {
  const now = Date.now();
  if (now >= start && now < end) return `On air now<small>until ${new Date(end).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</small>`;
  const s = Math.max(0, Math.round((start - now) / 1000));
  if (s >= 86400) { const d = Math.round(s / 86400); return `${d} day${d === 1 ? "" : "s"}<small>to go</small>`; }
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}<small>to go</small>`;
}
function todayCard(t) {
  if (!t) {
    return `<div class="card quiet" data-testid="today-none"><div><div class="lbl gold">Today</div><div class="t">Nothing on the calendar today.</div></div><button class="ghost" data-url="/radio/book">Book a show</button></div>`;
  }
  const start = Date.parse(t.startAt), end = Date.parse(t.endAt);
  const time = new Date(start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const when = [time, t.where, t.guest ? `with ${t.guest}` : ""].filter(Boolean).join(" · ");
  const soon = start - Date.now() < 12 * 3600000;
  return `<div class="card today" data-testid="today">
    <div class="lbl gold">${esc(dayLabel(start))}</div>
    <div class="row">
      <div class="txt"><h3>${esc(t.title)}</h3><div class="when">${esc(when)}</div><div class="count" id="count">${countdown(start, end)}</div></div>
      <button class="go" data-url="${esc(t.go)}">${soon ? "<i></i>Go live" : "Open"}</button>
    </div></div>`;
}

// ---- Your numbers ---------------------------------------------------------------------------------------------------
function tile(label, big, sub, cls, url, id) {
  return `<button class="num" data-url="${url}" data-testid="${id}" style="text-align:left;color:#fff;font:inherit"><div class="lbl" style="text-transform:none">${label}</div><div class="big">${big}</div><div class="delta ${cls}">${sub}</div></button>`;
}
function numbers(n) {
  const d = n.downloads, f = n.followers, s = n.discovery;
  let dSub = "No stats yet", dCls = "flat";
  if (d) {
    if (d.prev > 0) { const pct = Math.round(((d.week - d.prev) / d.prev) * 100); dSub = pct === 0 ? "Same as last week" : `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}%`; dCls = pct > 0 ? "" : pct < 0 ? "down" : "flat"; }
    else dSub = "This week";
  }
  let fSub = "Connect accounts", fCls = "flat", fBig = "—";
  if (f) {
    if (f.newThisWeek == null) { fBig = fmt(f.total); fSub = `On ${f.accounts} account${f.accounts === 1 ? "" : "s"}`; }
    else { fBig = `${f.newThisWeek >= 0 ? "+" : "−"}${fmt(Math.abs(f.newThisWeek))}`; fSub = `${fmt(f.total)} in all`; fCls = f.newThisWeek > 0 ? "" : f.newThisWeek < 0 ? "down" : "flat"; }
  }
  const tiles = [
    tile("Downloads", d ? fmt(d.week) : "—", dSub, dCls, "/host/dashboard/podcast-analytics", "num-downloads"),
    tile(f && f.newThisWeek != null ? "New followers" : "Followers", fBig, fSub, fCls, f ? "/host/dashboard/analytics" : "/host/dashboard/integrations", "num-followers"),
    tile("Discovery", s && s.score != null ? esc(s.score) : "—", s && s.score != null ? "Out of 100" : "Not checked yet", "flat", "/host/dashboard/discovery", "num-discovery"),
  ].join("");
  return `<div class="card" style="padding:10px"><div class="lbl" style="padding:0 2px 8px">Your numbers · this week</div><div class="nums">${tiles}</div>${d && d.trend.some((v) => v > 0) ? trend(d) : ""}</div>`;
}
function trend(d) {
  const v = d.trend, max = Math.max(...v, 1), W = 352, H = 32;
  const pts = v.map((y, i) => [Math.round((i / (v.length - 1)) * W), Math.round(H - (y / max) * (H - 4) + 2)]);
  const line = pts.map((p) => p.join(",")).join(" ");
  const days = d.days.map((k, i) => (i === d.days.length - 1 ? "Today" : new Date(k + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })));
  return `<div class="trend" data-testid="trend"><svg viewBox="0 0 ${W} 36" preserveAspectRatio="none" aria-label="Downloads, the last seven days">
    <defs><linearGradient id="f" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#f9b916" stop-opacity=".35"/><stop offset="1" stop-color="#f9b916" stop-opacity="0"/></linearGradient></defs>
    <path d="M${pts.map((p) => p.join(" ")).join(" L")} L${W} 36 L0 36 Z" fill="url(#f)"/>
    <polyline points="${line}" fill="none" stroke="#f9b916" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>
    <div class="days">${days.map((x) => `<span>${esc(x)}</span>`).join("")}</div></div>`;
}

// ---- What's new -----------------------------------------------------------------------------------------------------
const ICON = { clips: ["✂️", "rgba(249,185,22,.18)"], episode: ["🎙️", "rgba(127,224,164,.16)"], guest: ["🙋", "rgba(120,160,255,.18)"], question: ["💬", "rgba(255,255,255,.1)"], answered: ["✅", "rgba(127,224,164,.16)"] };
function whatsNew(items) {
  const rows = items.length
    ? items.map((x) => { const [ic, bg] = ICON[x.kind] || ["•", "rgba(255,255,255,.1)"]; return `<button class="item" data-url="${esc(x.url)}"><div class="ic" style="background:${bg}">${ic}</div><div class="t">${esc(x.title)}<small>${esc(x.sub)}</small></div><span class="chev">›</span></button>`; }).join("")
    : `<div class="caught">You're all caught up.</div>`;
  return `<div class="card new" data-testid="whats-new"><div class="lbl">What's new</div>${rows}</div>`;
}

const TOOLS = `<div class="tools">
  <button class="tool" data-tool="capture" title="Save the person on this page to Invite a guest"><b>＋</b>Add to show</button>
  <button class="tool" data-tool="prep" title="A one-page briefing from this page"><b>✎</b>Prep guest</button>
  <button class="tool" data-tool="import" title="Send the video on this page to your Library. Or right-click a video link."><b>↓</b>Send to Library</button>
</div>`;

function signedOut() {
  clearInterval(tick);
  $("me").hidden = true;
  $("body").innerHTML = `<div class="card out" data-testid="signed-out"><img class="wave" src="icons/wave.png" alt="">
    <h2>Sign in to MilitaryVoices</h2><p>Your next show, this week's numbers and what's new, one click away.</p>
    <button class="go" data-url="/host/dashboard">Sign in</button><div class="fine">Opens militaryvoices.ai in a new tab</div></div>`;
  $("foot-right").outerHTML = `<span class="dim">Not signed in</span>`;
}

function render(h) {
  $("me").hidden = false;
  $("me-show").textContent = h.show || h.name || h.email;
  const initials = (h.name || h.show || h.email || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  $("me-av").innerHTML = h.photo && /^https:/.test(h.photo) ? `<img src="${esc(h.photo)}" alt="">` : esc(initials);
  $("body").innerHTML = todayCard(h.today) + numbers(h.numbers || {}) + whatsNew(h.news || []) + TOOLS;
  if (h.today) {
    const start = Date.parse(h.today.startAt), end = Date.parse(h.today.endAt);
    clearInterval(tick);
    tick = setInterval(() => { const el = $("count"); if (el) el.innerHTML = countdown(start, end); }, 1000);
  }
}

// The Zoom reminder, when they've said "Don't ask again": the one place to turn it back on.
chrome.storage.local.get(ZOOM_NEVER, (v) => {
  if (!v || !v[ZOOM_NEVER]) return;
  $("foot-left").innerHTML = `<span class="dim">Zoom reminder off · </span><button class="link" id="zoom-on">Turn on</button>`;
  $("zoom-on").addEventListener("click", (e) => { e.stopPropagation(); chrome.storage.local.remove(ZOOM_NEVER, () => { $("foot-left").innerHTML = `<img src="icons/wave.png" alt="">Zoom reminder on`; }); });
});

// The last copy (kept in this browser only) shows at once; the fresh one replaces it a moment later.
const LAST = "mvHomeLast";
let shown = false;
chrome.storage.local.get(LAST, (v) => { if (!shown && v && v[LAST]) { shown = true; render(v[LAST]); } });
fetch(SITE + "/api/ext/home", { credentials: "include" })
  .then(async (r) => {
    if (r.status === 401 || r.status === 403) { chrome.storage.local.remove(LAST); shown = true; return signedOut(); }
    if (!r.ok) throw new Error(String(r.status));
    const h = await r.json();
    shown = true;
    render(h);
    chrome.storage.local.set({ [LAST]: h });
  })
  .catch(() => { if (!shown) $("body").innerHTML = `<div class="card loading">Couldn't reach MilitaryVoices just now. Close this and try again.</div>`; });
