# MilitaryVoices Zoom Reminder (Chrome extension)

A small reminder: when a Zoom meeting page opens (zoom.us/j, /s, /start, /wc), it shows one card, "Is cloud recording on?", with a button that opens the Zoom recording settings and an "It's on" button that keeps it quiet for six hours.

- It reads nothing from the page and sends nothing anywhere. The only thing stored (in the browser) is the time you pressed "It's on".
- Permissions: `storage`, and the zoom.us meeting pages it runs on.

## Try it
chrome://extensions → turn on Developer mode → Load unpacked → pick this folder. Open any zoom.us/j/... link.

## Publish
Zip this folder (`reminder.js`, `manifest.json`, `icons/`) and upload at https://chrome.google.com/webstore/devconsole (one-time $5 developer fee). Privacy policy: https://www.militaryvoices.ai/privacy (the extension collects no data). The ready zip is client/public/extension/MilitaryVoices-Zoom-Reminder.zip.
