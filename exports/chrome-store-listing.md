# Chrome Web Store listing: MilitaryVoices Companion

Upload: MilitaryVoices-Companion.zip (on your Desktop; also exports/ and client/public/extension/). In the existing draft use Package > "Upload new package".

## Store listing
**Name:** MilitaryVoices Companion (comes from the package)

**Summary (comes from the package):** Add guests to your show, send videos to your Library and prep for interviews from any page, plus a Zoom recording reminder.

**Description:**
MilitaryVoices Companion helps podcasters on MilitaryVoices.ai get more done from any web page. Everything happens when you click. It reads a page only when you ask it to.

ADD THIS PERSON TO MY SHOW
On a profile, bio or author page, add the person to your show. Their name, title, photo and short bio are saved to Invite a guest, ready for you to send an invitation.

PREP ME FOR THIS GUEST
Open a guest's profile or bio and ask for a briefing. In a few seconds you get a one-page summary of who they are, how to say their name, what is worth asking about, and a set of questions.

SEND TO MY LIBRARY
Right-click a direct video link and send it to your MilitaryVoices.ai Library, ready for clips and editing.

ZOOM REMINDER
When a Zoom meeting page opens, a small card asks: "Is cloud recording on?" One button opens your Zoom recording settings.

You need a free MilitaryVoices.ai account. Sign in at militaryvoices.ai in the same browser. The extension talks only to militaryvoices.ai with your own sign-in and collects nothing in the background.

**Category:** Productivity
**Language:** English (United States)
**Homepage URL:** https://www.militaryvoices.ai
**Support URL:** https://www.militaryvoices.ai/support

## Privacy tab
**Single purpose:** Help podcasters on MilitaryVoices.ai capture guests, videos and interview preparation from the web pages they visit, and remind them to turn on Zoom cloud recording.

**contextMenus:** Adds right-click choices: "Send to my MilitaryVoices Library", "Add this person to my MilitaryVoices show", and "Prep me for this guest".

**activeTab:** Lets the extension read the page the user is on, only after they click the toolbar button or a right-click choice, to take a person's details or the page text for a briefing.

**scripting:** Used to read that page and to show the result card on it, after the user's click.

**storage:** Remembers, in the browser only, when the user last pressed "It's on" on the Zoom reminder, so it stays quiet for six hours.

**Host permission, https://www.militaryvoices.ai/*:** Sends what the user asked for (a person's details, a video link, page text for a briefing) to their own MilitaryVoices.ai account, using their existing sign-in.

**Zoom meeting pages (content script on zoom.us/j, /s, /start, /wc):** Shows the reminder card. Nothing on the Zoom page is read or sent.

**Remote code:** No.
**Data usage:** Tick "Personally identifiable information" and "Website content". Say it is used only to provide the features the user asks for, sent only to MilitaryVoices.ai, and never sold or used for anything else. Tick all three certifications.
**Privacy policy URL:** https://www.militaryvoices.ai/privacy

## Access, Test instructions
Sign in at https://www.militaryvoices.ai with a free account (we will supply a test login on request). Open any profile or bio page, click the toolbar icon, and choose "Add this person to my show" or "Prep me for this guest". Open any zoom.us/j/123456789 page to see the reminder.

## Images
Store icon, screenshots 1280x800 (up to 5), small tile 440x280, marquee 1400x560: on your Desktop (screenshots and tiles need remaking for the new name and features).
