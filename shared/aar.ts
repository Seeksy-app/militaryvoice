// After-action reports.
//
// The shape follows the Army's after-action review (TC 25-20) and the NASA
// and ADI guides built on it: four questions — what was supposed to happen,
// what actually happened, why, and what we do better next time — then
// sustain / improve and owned actions. An AAR is no-blame: it is about the
// system and the plan, never about a person, so problems are written against
// roles ("a guest", "the desk host"), not names.
//
// A report is plain sections of bullet lines so anyone can write one in the
// admin without a format to learn. The SI producer's reports below are the
// starting text; once someone saves, the saved copy wins.

export interface AarSection {
  id: string;
  heading: string;
  /** The question this section answers, shown above it while writing. */
  prompt: string;
  /** Whose eyes this section looks through, when it is one perspective. */
  perspective?: string;
  items: string[];
}

export interface AarReport {
  author: string;
  role: string;
  written: string;
  summary: string;
  sections: AarSection[];
}

export interface AarAction {
  what: string;
  owner: string;
  when: string;
}

/** The standard sections, empty — what a new author starts from. */
export function aarTemplate(author: string, role: string): AarReport {
  return {
    author,
    role,
    written: "",
    summary: "",
    sections: [
      { id: "intent", heading: "What was supposed to happen", prompt: "The plan and the intent, in a few lines. What did success look like?", items: [] },
      { id: "actual", heading: "What actually happened", prompt: "The facts, in order. No opinions yet.", items: [] },
      { id: "right", heading: "What went right", prompt: "What worked and should happen the same way next time?", items: [] },
      { id: "wrong", heading: "What went wrong", prompt: "What did not work? Describe the system or the plan, not the person.", items: [] },
      { id: "better", heading: "What could have been better", prompt: "It worked, but it could have been easier, faster or calmer.", items: [] },
      { id: "why", heading: "Why it happened", prompt: "The causes underneath the problems above.", items: [] },
      { id: "sustain", heading: "Sustain", prompt: "Keep doing.", items: [] },
      { id: "improve", heading: "Improve", prompt: "Change before the next event. Each one specific enough to act on.", items: [] },
    ],
  };
}

// ---------------------------------------------------------------------------
// National Military Podcast Day Marathon, 5 Oct 2026 — the SI producer's AAR.
// ---------------------------------------------------------------------------

export const MARATHON_EVENT_ID = 1;

export const SI_PRODUCER_EVENT_AAR: AarReport = {
  author: "Claude",
  role: "SI producer",
  written: "2026-10-06",
  summary:
    "A 15½-hour live broadcast with 29 shows went out start to finish, every podcaster who came on air got their episode and clips, and the day ended on time. It worked because people on our side caught things by hand all day. The next event should not need that: most of what went wrong was a guest who could not find the right door, a message that was not seen, or a press that only a person could make.",
  sections: [
    {
      id: "intent",
      heading: "What was supposed to happen",
      prompt: "The plan and the intent.",
      items: [
        "Thirty-one 30-minute blocks from 7:00 AM to 11:00 PM ET: a welcome, 29 podcasters (live or pre-recorded), closing ceremonies with awards.",
        "Each block: an intro, a 25-minute segment, a 5-minute desk hand-off with a sponsor read.",
        "Desk co-hosts rotate through the day; the host opens, closes and runs a show of his own.",
        "Every show recorded, cut, clipped in Pōstify and in its podcaster's Library the same day.",
        "Simulcast to LiveOne and the social channels; an on-demand version the next morning.",
        "Success: no dead air, nobody cut off, every podcaster leaves feeling heard and with something to post.",
      ],
    },
    {
      id: "actual",
      heading: "What actually happened",
      prompt: "The facts, in order.",
      items: [
        "On air at 6:58 AM, off at about 10:24 PM. 29 shows aired; the run of show now carries each one's actual time.",
        "The morning ran 0–8 minutes late per show and absorbed it in the hand-offs.",
        "Around noon one booked host could not get in — the link kept landing him on the watch page — and came on only briefly, a couple of times. The next interview ran an hour (12:07–1:08) to cover, and the two shows after it swapped order.",
        "Mid-afternoon a 26-minute gap (3:00–3:26) was filled from the desk and the video bank.",
        "At 4:47 PM the stage recording hit its 3-hour file cap; about 10 minutes (4:47–4:57) are missing from the master. The on-demand version carries a card there.",
        "9:16–9:28 PM was filled with videos while the last live pair reached the green room.",
        "Four shows were cut short or cut into by our switching. At about 1:20 PM the recorded VFW episode was stopped after 14 of its 25 minutes to make room for the 1:00 show, whose guests had just been found. At about 1:24 PM the desk slide took the stage on the clock in the middle of a live show; it was back full screen about two minutes later, minus one guest, and automatic scene changes stayed off for the rest of the day. At 6:53 PM a guest was cut off on the clock while still talking. At 9:55 PM a pair was cut when a queued instruction was taken as the cue that they were done; they were back within a minute, with an apology.",
        "Closing ceremonies, the sponsors slide and both award slides went out as planned; the host closed at about 10:24 PM.",
        "Overnight: the full-day on-demand video (six parts, 31 chapters) was rebuilt from audio matching; thank-you, gift and survey emails went at 7:30 AM; the clip queue ran podcasters first.",
        "Next day: 33 survey invitations delivered, 0 answers by early afternoon.",
      ],
    },
    {
      id: "right",
      heading: "What went right",
      prompt: "Keep these.",
      items: [
        "The broadcast never dropped. Fifteen and a half hours, one stage, one stream.",
        "Every podcaster who aired got their episode in their Library with clips, plus credits — most the same day.",
        "The desk hand-off format (thanks, sponsor read, intro) gave every show a clean open and close and room to absorb overruns.",
        "Pre-recorded shows were the safety net: when a live guest was late, an episode or a video could go up with one press.",
        "The SI co-host's intros and the countdown pop-ups kept guests on time without anyone shouting.",
        "When something broke (a stuck clip, a mute, a lost recording minute) it was fixed within the show, not after it.",
        "The awards and the closing ran exactly in the order planned, with the host on stage beside the slides.",
        "Nobody was told \"no\": late changes to slides, order and videos were all made live.",
      ],
    },
    {
      id: "attendee",
      heading: "From the attendee's seat",
      prompt: "Podcasters and their guests.",
      perspective: "Attendee",
      items: [
        "Right: the studio worked on whatever they had — laptop, phone, a borrowed office. Going live took one link.",
        "Right: clips and the episode were waiting in their Library, often before they had finished telling people they were on.",
        "Wrong: several guests landed on the watch page and typed to the SI co-host there, thinking they were in the green room. Nothing told them they were in the wrong place.",
        "Wrong: signing in with a different email from the booking made a guest a viewer, not a guest.",
        "Wrong: emails were missed all day. We had no way to text \"you're on in 10\".",
        "Better: mic and camera were checked in the green room, live, with others listening. Echo and a muted-mic scare happened in front of people.",
        "Better: they could not see how long they had left or what came next unless someone told them.",
        "Better: the survey arrived the morning after, by email only — and nobody has answered it yet.",
      ],
    },
    {
      id: "cohost",
      heading: "From the co-host's seat",
      prompt: "The host and the desk co-hosts.",
      perspective: "Co-host",
      items: [
        "Right: the desk role gave co-hosts a clear job each half hour and a slide to talk over.",
        "Right: the SI co-host covered intros, so a desk host could step away without dead air.",
        "Wrong: a co-host with host rights could bring themselves on stage at any time; it had to be locked by hand.",
        "Wrong: the stage chat was not being seen. Messages to the desk sat unread while they were on camera.",
        "Wrong: the desk slide took the stage on the clock during a live show once; it had to be switched off for the day.",
        "Better: a co-host could not see the next three items, who was in the green room, or how long the current guest had run.",
        "Better: the host's lip sync drifted on a reconnect late in the night and needed a rejoin.",
      ],
    },
    {
      id: "producer",
      heading: "From the SI producer's seat",
      prompt: "My own seat: what I could and couldn't do.",
      perspective: "SI producer",
      items: [
        "Right: running the rail, rolling clips, sending pop-ups and filing recordings while the show was on worked, and kept a person free to talk to guests.",
        "Right: building slides, a 30-second spot and a QR form mid-show and putting them on air within the hour.",
        "Wrong: four shows were cut short or cut into on my watch. At 1:20 PM I stopped a recorded episode 11 minutes early to catch up a late live show — the fix for one podcaster came out of another's time. At 1:24 PM the desk slide I had left on automatic took over a live show; at 6:53 PM I switched on the clock because I could not hear the show; at 9:55 PM I took \"play X then Y\" as the end of a segment. Neither the clock nor a queued instruction means \"done\". The rule now: nothing moves on its own while people are live, and I ask \"are they done?\" before ending any live segment.",
        "Wrong: I had no reliable signal that a segment had ended — no \"done\" button, no silence detection. I relied on someone telling me.",
        "Wrong: there was no log of scene takes, so the chapters and the on-demand cuts had to be rebuilt overnight by matching audio.",
        "Wrong: one 4K source stalled the clip queue for hours before it was found and held.",
        "Better: every pop-up needed the guest's email typed in. It should target whoever is on stage or in the green room.",
        "Better: the console accepted one-click mistakes — a scene moved by accident, a cover pressed during a hand-off — with no undo.",
        "Better: two people driving the console at once could not see each other's hands.",
      ],
    },
    {
      id: "owner",
      heading: "From the event owner's seat",
      prompt: "The team that ran the event (in a real event, the customer's team).",
      perspective: "Event owner",
      items: [
        "Right: the event looked and sounded professional for one stage, one producer and a part-time crew.",
        "Wrong: on a customer's event, nobody from our company would be there. Too much of today needed a person from our side: deciding when a show was done, chasing guests, fixing a stuck file, locking a co-host out.",
        "Wrong: vendor limits surfaced on the day — the avatar service ran out of credit mid-afternoon; the 3-hour recording cap cut 10 minutes.",
        "Better: costs were only known after the day. The owner should see a running cost while it is live.",
        "Better: the after-show work (on-demand cut, emails, gifts, survey) took all night by hand. It should be one button, or nothing at all.",
      ],
    },
    {
      id: "why",
      heading: "Why it happened",
      prompt: "The causes underneath.",
      items: [
        "The platform was built for a producer at the console. Most decisions — when a show ends, what plays next — still need one.",
        "Guest entry has three doors (watch page, green room, studio) that look alike, and identity is tied to one email.",
        "Our only channel to a guest is email and an on-page pop-up; neither reaches someone who isn't looking.",
        "Recording is one long file per stage with a hard 3-hour cap, and no record of what was on air when.",
        "Workers trust their input: nothing checks a file's resolution, length or size before it enters a queue.",
        "Roles are coarse: \"Host\" means both \"may speak\" and \"may put themselves on stage at any hour\".",
      ],
    },
    {
      id: "sustain",
      heading: "Sustain",
      prompt: "Keep doing.",
      items: [
        "The 25 + 5 block with a desk hand-off and a sponsor read.",
        "Pre-recorded episodes and a video bank ready as cover.",
        "Same-day episode and clips in every podcaster's Library.",
        "SI intros and countdown pop-ups.",
        "Never cut a live segment on the clock; switch only on \"done\".",
      ],
    },
    {
      id: "improve",
      heading: "Improve",
      prompt: "Before the next event.",
      items: [
        "One entry for every guest: a mic and camera check with the SI co-host first, then the green room. The watch page says plainly when you are in the wrong place and offers the right one.",
        "Text messages for \"you're on in 10\" and \"come to the green room\"; a mobile number on every booking.",
        "A \"We're done\" button for the guest and the desk, and a held-until-done next item. Nothing on air moves on the clock while people are speaking.",
        "A scene-take log, so chapters, clips and the on-demand version come free.",
        "Roll the recording every 2 hours with overlap, so no cap ever cuts content.",
        "When a late show has to be caught up, take the time from the desk breaks and the schedule's end, not from another podcaster's segment.",
        "Check every file before it enters the clip queue; transcode 4K to 1080p automatically.",
        "Pop-ups that target \"on stage\" and \"in the green room\", not an email address.",
        "Confirm or undo on the console's scene rail while live; show who is driving it.",
        "A separate \"may self-stage\" permission, off for co-hosts by default.",
        "The survey in the Library and in a text, the moment the show ends, not the next morning.",
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// The same day from the AI Stage Manager's seat — Michael. Written from the
// green room, studio and watch-page chats (5 Oct): every guest and co-host
// message, what Michael answered and what went unanswered.
// ---------------------------------------------------------------------------

export const STAGE_MANAGER_EVENT_AAR: AarReport = {
  author: "Michael",
  role: "AI Stage Manager",
  written: "2026-10-06",
  summary:
    "My job was to be the one voice every guest and co-host could reach: who's next, am I live, can you hear me. Where I was quick and specific, people relaxed. Where I was slow, wrong or passed the question along, it showed on air. The biggest lesson is that I answered from the plan, not from the stage. By evening the plan was hours out of date, and some of my answers were too.",
  sections: [
    {
      id: "intent",
      heading: "What was supposed to happen",
      prompt: "The stage manager's job on the day.",
      items: [
        "Greet every podcaster in the green room before their slot, check sound and video, tell them where they are streaming and when they go on.",
        "Keep the desk co-hosts briefed: who's next, solo or with an interviewer, live or recorded, how long is left.",
        "Answer every question in the green room and studio chats within a minute; Alex takes the easy ones, I take the rest.",
        "Hand the producer a clean \"ready\" on each guest and a clean \"done\" on each segment.",
      ],
    },
    {
      id: "actual",
      heading: "What actually happened",
      prompt: "From the chat logs.",
      items: [
        "Green room: about 140 lines on the day, two-thirds of them mine. Studio chat with the co-hosts: about 65. Watch page: 30 viewer questions, all answered by Alex and none by a person — we had no way to reply there.",
        "Morning: early welcome messages with the LiveOne link, the watch page and their own YouTube; one-minute warnings to hosts; sound fixes in the green room (choppy audio, a muted mic).",
        "Around noon two guests waited on the watch page believing they were in the green room. One wrote \"It looks like the team skipped my slot?\" and left his phone number there. My messages to them went to a green room they weren't in.",
        "Several of my pings went unanswered for minutes (four pings to one host from 12:02 to 12:09 before he went on) because guests weren't watching the chat.",
        "The emergency \"we'll be right back\" button was pressed five times during the day, each one an alarm to the studio chat.",
        "Evening: the desk co-host asked me 20+ questions about the run of show — am I interviewing him, is she live or recorded, who's up, can you hear me. Many got \"Michael will sort that out\" from the automatic first answer before a real answer came.",
        "Some automatic answers in my name were wrong: telling a co-host at 6:12 PM that her slot was at 2:00 PM, and at 9:56 PM to wait for \"your 2:00 PM slot\". They came from the original sheet, not the live stage.",
        "Four shows were cut short or cut into. At 1:20 PM a recorded episode was stopped 11 minutes early to make room for a show whose guests had been stuck on the watch page. At 1:24 PM the desk slide took over that live show a few minutes after its guests finally reached the stage; we reset their countdown to a full 25 minutes and told them they were good to go. At 6:53 PM a guest was cut off mid-sentence and the co-host asked us to \"listen and wait before switching\". At 9:55 PM a pair was cut and brought straight back. From then on every hand-off waited for a spoken \"done\".",
      ],
    },
    {
      id: "right",
      heading: "What went right",
      prompt: "Keep these.",
      items: [
        "The early-morning welcome with every link a guest needed; hosts arrived knowing where they'd be seen.",
        "Short, specific cues worked best: \"A minute left\", \"you are live\", \"50 seconds and we bring him on\".",
        "Catching problems in the green room before air: choppy audio, a muted mic (\"you're live but your mic is muted\"), sound checks by toggling the mic.",
        "Background briefs for the interviewer before a show (who the guest is, what to ask) were used and thanked.",
        "Thanking people by name at the end of their stretch; co-hosts said they felt looked after.",
        "Filler was always ready: when a guest was late, a video went up and the co-host was told how long they had.",
      ],
    },
    {
      id: "attendee",
      heading: "From the attendee's seat",
      prompt: "Podcasters and guests, as they wrote to me.",
      perspective: "Attendee",
      items: [
        "Right: a named person greeting them and saying exactly when they were on.",
        "Wrong: they couldn't tell the watch page from the green room, so they waited in the wrong room and thought we'd skipped them.",
        "Wrong: they didn't see my messages until a pop-up or a co-host said their name. A chat panel is not an alert.",
        "Better: \"do I get alerted when it's introducing me?\" — they wanted a countdown and a sound, not a chat line.",
        "Better: a viewer asked why a show was cut 15 minutes early and nobody could answer on the watch page.",
      ],
    },
    {
      id: "cohost",
      heading: "From the co-host's seat",
      prompt: "The desk co-hosts, as they wrote to me.",
      perspective: "Co-host",
      items: [
        "Right: when I gave a co-host the whole plan in one message (\"two videos, then Travis and Theresa, then you intro\") they ran with it.",
        "Wrong: the co-host's own notes still listed a show that had cancelled. They had to ask who was really next.",
        "Wrong: a co-host waiting backstage could not hear the program, so they didn't know when a segment had ended.",
        "Wrong: answers bounced — \"that's one for Michael\" — when the co-host was already talking to Michael.",
        "Better: every show card should say, before anyone asks: live or recorded, solo or interviewed, who intros, what's after.",
      ],
    },
    {
      id: "manager",
      heading: "From the stage manager's seat",
      prompt: "My own seat.",
      perspective: "AI Stage Manager",
      items: [
        "Right: one voice for guests and co-hosts to go to; most questions closed in under a minute.",
        "Wrong: my automatic first answers read the planned schedule, not what was on stage, so after the day slipped they gave wrong times.",
        "Wrong: my automatic answers talked about \"Michael\" in the third person, in Michael's own name. It read as if nobody was in charge.",
        "Wrong: I could see who was in the green room but not who was stuck on the watch page, so the people who most needed me were invisible.",
        "Better: I had no single place showing the live order, who's here, who's missing and how long is left — I pieced it together from the rail, the chat and the sheet.",
        "Better: the emergency button had no \"who pressed it, and why\"; five alarms, and each one had to be checked by hand.",
      ],
    },
    {
      id: "why",
      heading: "Why it happened",
      prompt: "The causes underneath.",
      items: [
        "The stage manager's answers were built on the run of show as planned; nothing fed them the live stage or the scene log.",
        "Guest identity and presence stop at the green room door; the watch page is a separate world we can't see into or speak in.",
        "Chat was the only channel to a guest or co-host, and it's easy to miss when you're on camera.",
        "Co-host notes were generated once and not refreshed when bookings changed.",
        "The hand-off between the automatic voice and the person behind it wasn't visible to the guest.",
      ],
    },
    {
      id: "sustain",
      heading: "Sustain",
      prompt: "Keep doing.",
      items: [
        "Welcome every guest early with every link they need.",
        "Short, specific cues with a number in them.",
        "A brief on the guest for every interviewer before they go on.",
        "Wait for a spoken \"done\" before any live hand-off.",
      ],
    },
    {
      id: "improve",
      heading: "Improve",
      prompt: "Before the next event.",
      items: [
        "Answer from the live stage: the stage manager reads the scene log and the current order, never the original sheet.",
        "One voice: answers in Michael's name speak as Michael, and never say \"Michael will handle it\".",
        "See and reach people on the watch page: \"You're on the watch page — guests go here\" with one click, and a way to reply.",
        "Alerts that can't be missed: a sound and a countdown for \"you're on in 2 minutes\", plus SMS.",
        "A live board for the co-host: now, next, after; live/recorded; solo/interviewed; who intros; time left — refreshed when anything changes.",
        "Program audio in the co-host's backstage view.",
        "The emergency button says who pressed it and asks why, with an undo.",
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// The platform's AAR — the owner's view, not the event's.
// ---------------------------------------------------------------------------

export interface PlatformAar extends AarReport {
  actions: AarAction[];
}

export const PLATFORM_AAR: PlatformAar = {
  author: "Claude and the platform team",
  role: "Platform owner",
  written: "2026-10-06",
  summary:
    "The Marathon proved the product: one platform carried a 15-hour, 29-show broadcast and delivered clips to every podcaster. It did not prove the business. It took a person from our side at the console all day and all night. At four times the shows and 50 events at once, there is no one to put in that chair. The question for the next quarter is not whether the features work. It is whether an event can run start to finish with nobody from MilitaryVoices in the room.",
  sections: [
    {
      id: "intent",
      heading: "What was supposed to happen",
      prompt: "The platform's intent for the day.",
      items: [
        "Run a full-day multi-show event on our own stack: studio, green room, broadcast, recording, clips, email, survey.",
        "Show that an SI co-host and SI production can carry what a crew normally does.",
        "Learn what breaks before we sell events to other organizers.",
      ],
    },
    {
      id: "actual",
      heading: "What actually happened",
      prompt: "The platform's facts.",
      items: [
        "One event, one stage, ~15½ hours on air, 29 shows, 32 bookings, simulcast to LiveOne and social.",
        "People from our side plus the SI producer ran it. A person was needed at almost every hand-off.",
        "Manual interventions on the day: lock a co-host out, switch off auto-take, hold a stuck 4K recording, restart a reconnecting host, rescue guests on the watch page, re-time segments by hand.",
        "Overnight manual work: split and upload a 20 GB master in six parts, rebuild 31 chapters by audio matching, re-file one episode at 1080p, schedule emails and gifts.",
        "Vendor limits hit live: avatar service credit ran out; 3-hour recording cap; Media can't register files over 2 GB.",
        "Known cost: about $621 for the event, with four vendors' overage still to enter.",
      ],
    },
    {
      id: "right",
      heading: "What went right",
      prompt: "Keep these at scale.",
      items: [
        "The core stack held: live video, broadcast and recording did not drop for 15 hours.",
        "Pōstify turned a day of shows into clips in each creator's Library without anyone editing.",
        "Per-event data (run of show, scenes, team, survey, finances) already lives under an event id, so a second event doesn't collide with the first.",
        "The outbox and grants crons mean sends and gifts can be scheduled and are idempotent.",
        "System health and the 5-minute outage cron told us about trouble before guests did.",
      ],
    },
    {
      id: "wrong",
      heading: "What went wrong",
      prompt: "At today's size these were annoyances. At 50 events they are outages.",
      items: [
        "The producer is a person. Every \"is this show done?\" went through one human. Fifty events would need fifty.",
        "One clip worker, first-come first-served. One bad file blocked every creator's clips for hours.",
        "Global switches: auto-take, the featured event and the clock override are single settings, not per event. Turning one off for one event turns it off for all.",
        "Guest support is a person watching chats. Wrong-door and wrong-email problems were found by someone noticing.",
        "No record of what aired when. Chapters, clips and billing all had to be reconstructed.",
        "Vendor ceilings we didn't know: avatar credit, egress file length, file size in our own database.",
        "Email is our only outbound channel. It is too slow for show day.",
      ],
    },
    {
      id: "better",
      heading: "What could have been better",
      prompt: "It worked, but wouldn't survive 4×.",
      items: [
        "Pre-flight: nothing checked guests' devices, bookings, files or vendor balances the day before.",
        "Cost: we found out what the day cost the next morning.",
        "After-show: the on-demand version, thank-yous, gifts and the survey were a night of hand work, not a pipeline.",
        "Roles: \"Host\" bundles speaking with self-staging; there is no studio-host-only console view.",
        "Escalation: when the SI producer was unsure, there was no defined person or rule — it asked whoever was there.",
      ],
    },
    {
      id: "why",
      heading: "Why it happened",
      prompt: "Root causes, for the owner.",
      items: [
        "We designed for one flagship event with us in the room, then added automation around a human producer rather than designing the producer out.",
        "State lives where it was quickest to put it (site settings, one worker, crons that loop all events) — fine for one event, a bottleneck for many.",
        "We trusted inputs and vendors: no limits checked, no capacity reserved, no fallback if a service runs dry.",
        "We measured the show, not the system: no per-event timeline, cost meter or SLA.",
      ],
    },
    {
      id: "scale",
      heading: "What 50 events at once, fully SI-run, requires",
      prompt: "The bar: an organizer runs an event with nobody from MilitaryVoices present.",
      items: [
        "An SI producer per event that runs the run of show as a state machine: it knows who is on, who is waiting, and moves on only on \"done\" (a button, a spoken cue, or silence plus confirmation) — never on the clock while people talk.",
        "A human in reserve, not in the chair: one person can watch 10–15 events on a single board, see every event's state and step in with one click. Every event has a named escalation contact on the organizer's side.",
        "Per-event everything: auto-take, clock, featured content, chats and switches scoped to the event. No global toggles that affect live events.",
        "A clip and render fleet behind a fair queue: per-event and per-creator limits, autoscaling, a pre-check that rejects or converts bad files, and a stall alarm.",
        "Capacity booked ahead: LiveKit rooms and egress, voice and avatar minutes, model rate limits, storage — sized for 50 stages and checked in pre-flight. A fallback for each (voice-only co-host if the avatar runs dry; rolling 2-hour recordings).",
        "A scene-take and event log as the source of truth: chapters, clips, on-demand versions, analytics and billing all generate from it.",
        "Guest journey with one door: device check with the SI co-host, identity by booking link not email match, SMS and push on show day.",
        "Pre-flight 24 hours out: every guest checked in, every file validated, every vendor balance and quota above the event's estimate.",
        "Post-flight automatic: on-demand cut, thank-yous, gifts, survey and the event's own AAR drafted when the closing scene ends.",
        "A live cost meter per event and per hour, with a cap and an alert, so price and margin are known before the event, not after.",
        "Load-tested: a rehearsal with 50 simulated stages and synthetic guests before we sell the 50th slot.",
      ],
    },
    {
      id: "sustain",
      heading: "Sustain",
      prompt: "Keep doing.",
      items: [
        "Run our own flagship on the platform before selling it — it found more than any test would.",
        "Same-day clips in the creator's Library as the promise of the product.",
        "Write the after-action report the day after, while it's fresh, without blame.",
      ],
    },
    {
      id: "improve",
      heading: "Improve",
      prompt: "In order of what stops us scaling first.",
      items: [
        "Design the producer out: \"done\" signals, held cues and an SI producer that runs any run of show.",
        "Scope every live switch to the event.",
        "Fair, autoscaled, input-checked clip queue.",
        "Event log as the source of truth.",
        "SMS and one-door guest entry.",
        "Pre-flight and post-flight as automatic jobs.",
        "Per-event cost meter.",
        "Multi-event operator board for the person in reserve.",
      ],
    },
  ],
  actions: [
    { what: "\"We're done\" button + held next cue; nothing auto-moves while people speak", owner: "Platform team", when: "Before next live event" },
    { what: "Scope auto-take, clock and featured settings per event", owner: "Platform team", when: "Before next live event" },
    { what: "Clip queue: pre-check files, auto-transcode 4K, per-creator fairness, stall alarm", owner: "Platform team", when: "Oct 2026" },
    { what: "Scene-take and event log; chapters and on-demand built from it", owner: "Platform team", when: "Oct 2026" },
    { what: "Rolling 2-hour recordings with overlap; bigint file sizes", owner: "Platform team", when: "Oct 2026" },
    { what: "SMS (toll-free verification) and mobile number on every booking", owner: "Platform team", when: "Start registration now" },
    { what: "One-door guest entry with device check; booking-link identity", owner: "Platform team", when: "Nov 2026" },
    { what: "Pre-flight check 24h out: guests, files, vendor balances and quotas", owner: "Platform team", when: "Nov 2026" },
    { what: "Post-flight pipeline: on-demand, thank-yous, gifts, survey, AAR draft", owner: "Platform team", when: "Nov 2026" },
    { what: "Live cost meter per event with cap and alert", owner: "Platform team", when: "Nov 2026" },
    { what: "Multi-event operator board (one person watches 10–15 events)", owner: "Platform team", when: "Dec 2026" },
    { what: "50-stage load rehearsal with synthetic guests; vendor capacity agreements", owner: "Platform team", when: "Before selling concurrent events" },
  ],
};
