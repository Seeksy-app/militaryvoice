// MilitaryVoices Companion: the three things it does from any page.
// Each one runs only when the person clicks (the toolbar button or the right-click menu), reads only the page they are on,
// and talks only to militaryvoices.ai with their own sign-in.
const SITE = "https://www.militaryvoices.ai";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "mv-import", title: "Send to my MilitaryVoices Library", contexts: ["link", "video", "audio"] });
    chrome.contextMenus.create({ id: "mv-capture", title: "Add this person to my MilitaryVoices show", contexts: ["page"] });
    chrome.contextMenus.create({ id: "mv-prep", title: "Prep me for this guest (MilitaryVoices)", contexts: ["page", "selection"] });
  });
});

async function api(path, body) {
  const res = await fetch(SITE + path, {
    method: body ? "POST" : "GET",
    credentials: "include",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (res.status === 401 || res.status === 403) { const err = new Error("signin"); err.signin = true; throw err; }
  if (!res.ok) throw new Error(data.message || "Something went wrong. Try again in a moment.");
  return data;
}

// Drawn into the page the person is on, so the answer is right where they asked.
function showCard(card) {
  const old = document.getElementById("mv-companion-card");
  if (old) old.remove();
  const host = document.createElement("div");
  host.id = "mv-companion-card";
  host.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const sections = (card.sections || []).map((s) => `<h3>${esc(s.h)}</h3>` + (s.items ? `<ul>${s.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : `<p>${esc(s.text)}</p>`)).join("");
  const actions = (card.actions || []).map((a) => `<a class="btn" href="${esc(a.href)}" target="_blank" rel="noopener">${esc(a.label)}</a>`).join("");
  root.innerHTML = `<style>
    .card{font:14px/1.45 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#00083f;color:#fff;width:380px;max-width:92vw;max-height:84vh;overflow:auto;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.4);padding:16px 18px 16px;border:1px solid rgba(240,167,31,.55);text-align:left;position:relative}
    .eyebrow{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#f0a71f;font-weight:700;margin:0 0 6px}
    h2{font-size:17px;margin:0 0 4px;font-weight:700;padding-right:24px}
    .sub{margin:0 0 10px;color:#9fb0d0;font-size:13px}
    h3{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#f0a71f;margin:14px 0 4px}
    p{margin:0 0 8px;color:#dbe4f5} ul{margin:0;padding-left:18px;color:#dbe4f5} li{margin:0 0 4px}
    .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
    .btn,button{font:inherit;font-weight:600;font-size:13px;border-radius:999px;padding:8px 16px;cursor:pointer;text-decoration:none;border:0;background:#f0a71f;color:#1a1200}
    .alt{background:rgba(255,255,255,.14);color:#fff}
    .x{position:absolute;top:8px;right:12px;background:none;color:#9fb0d0;font-size:20px;padding:0 4px;line-height:1}
    .err{color:#ffb4a8}
    img.face{width:48px;height:48px;border-radius:50%;object-fit:cover;float:left;margin:0 12px 6px 0}
  </style>
  <div class="card" role="dialog" aria-label="MilitaryVoices">
    <button class="x" aria-label="Close">×</button>
    <p class="eyebrow">MilitaryVoices.ai</p>
    ${card.photo ? `<img class="face" src="${esc(card.photo)}" referrerpolicy="no-referrer" alt="">` : ""}
    <h2 class="${card.error ? "err" : ""}">${esc(card.title)}</h2>
    ${card.subtitle ? `<p class="sub">${esc(card.subtitle)}</p>` : ""}
    <div style="clear:both"></div>
    ${sections}
    <div class="row">${actions}${card.copy ? `<button class="alt" id="copy">Copy</button>` : ""}</div>
  </div>`;
  root.querySelector(".x").addEventListener("click", () => host.remove());
  const copy = root.getElementById ? root.getElementById("copy") : root.querySelector("#copy");
  if (copy) copy.addEventListener("click", () => { navigator.clipboard.writeText(card.copy).then(() => { copy.textContent = "Copied"; }, () => {}); });
  (document.body || document.documentElement).appendChild(host);
}

// What a person's page gives us: the page's own markup (JSON-LD, Open Graph), with LinkedIn's "Name - Headline | LinkedIn" title as a fallback.
function readPerson() {
  const meta = (s) => { const el = document.querySelector(s); return el ? (el.content || "").trim() : ""; };
  let person = null;
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const j = JSON.parse(s.textContent);
      for (const x of [].concat(j, j && j["@graph"] ? j["@graph"] : [])) {
        if (x && /Person/.test([].concat(x["@type"] || []).join(","))) { person = x; break; }
      }
    } catch (e) { /* not ours to read */ }
    if (person) break;
  }
  const rawTitle = (meta('meta[property="og:title"]') || document.title || "").replace(/\s*\|\s*LinkedIn\s*$/i, "").replace(/^\(\d+\)\s*/, "");
  const parts = rawTitle.split(/\s+[-–|]\s+/);
  const h1 = (document.querySelector("h1") || {}).innerText || "";
  const org = person && person.worksFor ? [].concat(person.worksFor)[0].name || "" : "";
  const img = person && person.image ? (typeof person.image === "string" ? person.image : [].concat(person.image)[0].url || person.image.contentUrl || "") : "";
  return {
    name: (person && person.name) || (/linkedin\.com/.test(location.host) ? parts[0] : (h1 || parts[0])),
    title: (person && person.jobTitle) || (parts.length > 1 ? parts.slice(1).join(" - ") : ""),
    org,
    photoUrl: img || meta('meta[property="og:image"]'),
    bio: (person && person.description) || meta('meta[property="og:description"]') || meta('meta[name="description"]'),
    url: location.href,
  };
}
function readPage() {
  const sel = (window.getSelection ? String(window.getSelection()) : "").trim();
  return { title: document.title, url: location.href, text: sel.length > 400 ? sel : (document.body ? document.body.innerText : "") };
}

async function onTab(tab, fn, ...args) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fn, args });
  return r && r.result;
}
async function draw(tab, card) { await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: showCard, args: [card] }); }
const signIn = { error: true, title: "Sign in to MilitaryVoices.ai first", subtitle: "Open militaryvoices.ai in this browser and sign in, then try again.", actions: [{ label: "Open militaryvoices.ai", href: SITE + "/host/dashboard" }] };

async function addPerson(tab) {
  try {
    const p = await onTab(tab, readPerson);
    const r = await api("/api/ext/capture", p);
    const c = r.capture || p;
    await draw(tab, {
      title: r.already ? `${c.name} is already saved` : `Added: ${c.name}`,
      subtitle: [c.title, c.org].filter(Boolean).join(" · "),
      photo: c.photoUrl,
      sections: [{ h: "Next", text: "They're in Invite a guest under Saved from your browser. Press Invite to send their invitation." }],
      actions: [{ label: "Open Invite a guest", href: SITE + "/host/dashboard/podcast" }],
    });
  } catch (e) { await draw(tab, e.signin ? signIn : { error: true, title: "Couldn't add them", subtitle: e.message }); }
}

async function prep(tab) {
  await draw(tab, { title: "Preparing your briefing…", subtitle: "Alex is reading this page. It takes a few seconds." });
  try {
    const page = await onTab(tab, readPage);
    const b = await api("/api/ext/prep", page);
    const copy = [b.name, b.headline, "", b.summary, "", "Talking points:", ...b.talkingPoints.map((x) => "- " + x), "", "Questions:", ...b.questions.map((x, i) => `${i + 1}. ${x}`)].join("\n");
    await draw(tab, {
      title: b.name || "Guest briefing", subtitle: b.headline,
      sections: [
        { h: "Who they are", text: b.summary },
        b.pronounce ? { h: "How to say it", text: b.pronounce } : null,
        b.careful ? { h: "Handle with care", text: b.careful } : null,
        { h: "Worth asking about", items: b.talkingPoints },
        { h: "Questions", items: b.questions },
      ].filter(Boolean),
      copy,
    });
  } catch (e) { await draw(tab, e.signin ? signIn : { error: true, title: "Couldn't prepare that", subtitle: e.message }); }
}

async function sendVideo(tab, url) {
  try {
    const r = await api("/api/ext/import", { url, title: tab.title || "" });
    await draw(tab, { title: r.already ? "Already in your Library" : "On its way to your Library", subtitle: r.message, actions: [{ label: "Open my Library", href: SITE + "/host/dashboard/library" }] });
  } catch (e) { await draw(tab, e.signin ? signIn : { error: true, title: "Couldn't send that", subtitle: e.message }); }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;
  if (info.menuItemId === "mv-capture") addPerson(tab);
  if (info.menuItemId === "mv-prep") prep(tab);
  if (info.menuItemId === "mv-import") sendVideo(tab, info.linkUrl || info.srcUrl || "");
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg.type === "me") {
      try { reply({ ok: true, me: await api("/api/ext/me") }); } catch (e) { reply({ ok: false, signin: !!e.signin }); }
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return reply({ ok: false });
    if (msg.type === "capture") await addPerson(tab);
    if (msg.type === "prep") await prep(tab);
    if (msg.type === "import") await sendVideo(tab, tab.url || "");
    reply({ ok: true });
  })();
  return true;
});
