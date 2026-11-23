# MilitaryVoices Companion (Chrome extension)

**The popup** (v2.1, Andrew 23 Nov): Today (their next Radio slot or interview, a countdown and Go live; "Book a show" when nothing is booked), Your numbers this week (downloads, followers, Discovery score from the saved row only, never an Influencers Club read) and What's new (up to four: clips ready, an episode published, a guest request, a question or a guest's answers). One read, `GET /api/ext/home`, only while the popup is open. The last copy is kept in this browser so it shows at once.

Also four things, all on the click of the person using it:

1. **Add this person to my show.** On a profile, bio or author page: reads the name, title, photo and short bio from the page's own markup and saves them to Invite a guest ("Saved from your browser").
2. **Prep me for this guest.** Sends the text of the page (or the selected text) to Alex and shows a one-page briefing: who they are, how to say the name, what to ask.
3. **Send to my Library.** Right-click a direct video link and choose "Send to my MilitaryVoices Library". YouTube and other video-site pages can't be brought in; a direct file link (Dropbox, Drive, a recording tool) can.
4. **Zoom reminder.** When a Zoom meeting page opens, "Is cloud recording on?" "Don't ask again" turns it off in this browser; the popup's footer turns it back on.

It reads a page only when the person clicks (toolbar button or right-click menu; the Zoom card runs only on Zoom meeting pages). It talks only to www.militaryvoices.ai, with the person's own sign-in (their browser sends their session cookie). Nothing is collected in the background.

Server side: `server/extensionApi.ts` (/api/ext/me, /api/ext/home, /api/ext/capture, /api/ext/import, /api/ext/prep) and the Saved list in `client/src/components/GuestInvites.tsx`.

## Try it
chrome://extensions → Developer mode → Load unpacked → pick this folder. Sign in at militaryvoices.ai in the same browser first.

## Publish
Bump the version in manifest.json, then zip `manifest.json background.js popup.html popup.js reminder.js icons/` and upload at the Chrome Web Store developer dashboard. Ready zip: client/public/extension/MilitaryVoices-Companion.zip. Listing text: exports/chrome-store-listing.md.
