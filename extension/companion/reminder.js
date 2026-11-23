// MilitaryVoices Zoom Reminder.
// When a Zoom meeting page opens, show one small card: "Is cloud recording on?"
// It reads nothing from the page and sends nothing anywhere. All it remembers (in this browser only) is when you last
// said "It's on", and whether you said "Don't ask again" (Andrew, 23 Nov: "if he doesn't want to be asked, he can say,
// 'Don't ask anymore.'"). The popup's footer turns it back on.
(function () {
  const KEY = "mvCloudRecordingOk";
  const NEVER = "mvZoomNever";
  const SNOOZE_MS = 6 * 60 * 60 * 1000; // after "It's on", stay quiet for six hours
  const SETTINGS = "https://zoom.us/profile/setting?tab=recording";

  function show() {
    if (document.getElementById("mv-zoom-reminder")) return;
    const host = document.createElement("div");
    host.id = "mv-zoom-reminder";
    host.style.cssText = "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        .card{font:14px/1.45 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#00083f;color:#fff;width:420px;max-width:92vw;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.35);padding:16px 18px 14px;border:1px solid rgba(240,167,31,.55);text-align:left}
        .eyebrow{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#f0a71f;font-weight:700;margin:0 0 6px}
        h2{font-size:17px;margin:0 0 6px;font-weight:700}
        p{margin:0 0 12px;color:#dbe4f5}
        .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
        .never{margin-left:auto;background:none;color:#9fb0d0;font-weight:500;font-size:12px;padding:4px 2px;text-decoration:underline;text-underline-offset:2px}
        .never:hover{color:#fff}
        button,a.btn{font:inherit;font-weight:600;font-size:13px;border-radius:999px;padding:8px 16px;cursor:pointer;text-decoration:none;border:0}
        .go{background:#f0a71f;color:#1a1200}
        .ok{background:rgba(255,255,255,.14);color:#fff}
        .x{position:absolute;top:8px;right:12px;background:none;color:#9fb0d0;font-size:20px;padding:0 4px;line-height:1}
        .card{position:relative}
      </style>
      <div class="card" role="dialog" aria-label="MilitaryVoices reminder">
        <button class="x" aria-label="Close">×</button>
        <p class="eyebrow">MilitaryVoices.ai</p>
        <h2>Is cloud recording on?</h2>
        <p>When you record to the cloud, the recording comes into your Library by itself. If it is off, there is nothing for us to pick up.</p>
        <div class="row">
          <a class="btn go" href="${SETTINGS}" target="_blank" rel="noopener">Check my Zoom setting</a>
          <button class="ok">It's on</button>
          <button class="never">Don't ask again</button>
        </div>
      </div>`;
    root.querySelector(".x").addEventListener("click", () => host.remove());
    root.querySelector(".ok").addEventListener("click", () => {
      try { chrome.storage.local.set({ [KEY]: Date.now() }); } catch (e) { /* storage unavailable: it will show next time */ }
      host.remove();
    });
    root.querySelector(".never").addEventListener("click", () => {
      try { chrome.storage.local.set({ [NEVER]: true }); } catch (e) { /* storage unavailable */ }
      host.remove();
    });
    (document.body || document.documentElement).appendChild(host);
    // Gone by itself after a minute, so it never sits over the meeting.
    setTimeout(() => host.remove(), 60 * 1000);
  }

  try {
    chrome.storage.local.get([KEY, NEVER], (v) => {
      if (v && v[NEVER]) return;
      const last = v && v[KEY];
      if (!last || Date.now() - last > SNOOZE_MS) show();
    });
  } catch (e) {
    show();
  }
})();
