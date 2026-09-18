import { useEffect } from "react";
import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";

// The privacy policy and terms, at the URLs registered on the Google OAuth
// consent screen. A reviewer clicks both, so they have to be public, reachable
// without signing in, and actually describe what the software does — which is
// also the only reason to write them.

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
const UPDATED = "13 September 2026";
const CONTACT = "hello@militaryvoice.ai";

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  useEffect(() => {
    document.title = `${title} — MilitaryVoice.ai`;
  }, [title]);

  return (
    <div className="min-h-screen">
      <NavBar />
      <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl" style={HEADLINE_FONT}>
          {title}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated {UPDATED}</p>
        <div className="mt-10 flex flex-col gap-8 text-[15px] leading-relaxed text-foreground">{children}</div>
        <div className="mt-14 border-t border-border pt-6 text-sm text-muted-foreground">
          Questions about any of this? Write to{" "}
          <a className="text-primary hover:underline" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>
          . See also our{" "}
          <Link href={title === "Privacy policy" ? "/terms" : "/policy"} className="text-primary hover:underline">
            {title === "Privacy policy" ? "terms of service" : "privacy policy"}
          </Link>
          .
        </div>
      </div>
    </div>
  );
}

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold tracking-tight" style={HEADLINE_FONT}>
        {heading}
      </h2>
      <div className="mt-2 flex flex-col gap-3 text-muted-foreground">{children}</div>
    </section>
  );
}

export function PrivacyPolicy() {
  return (
    <Shell title="Privacy policy">
      <p className="text-base text-foreground">
        MilitaryVoice.ai is a platform for running live, multi-speaker podcast events. This explains what we hold
        about you, why, and how to get rid of it. It is written to be read, not to protect us.
      </p>

      <Section heading="What we collect">
        <p>
          <strong className="text-foreground">If you book a slot:</strong> your name, email address, phone number if
          you give one, your show's name and description, your photo, your links and social handles, and whatever you
          tell us about your show — guests, questions, and how you normally record.
        </p>
        <p>
          <strong className="text-foreground">If you upload material:</strong> intros, outros, sponsor reels, images
          and slides you send us to play during your slot.
        </p>
        <p>
          <strong className="text-foreground">If you appear in the studio:</strong> your camera and microphone while
          you are connected, and a recording of your segment if the producer records it.
        </p>
        <p>
          <strong className="text-foreground">If you sign in:</strong> your email address and a short-lived code. We
          have no passwords, because we never ask for one.
        </p>
      </Section>

      <Section heading="If you connect your YouTube channel">
        <p>
          Connecting is optional and exists for one purpose: so your segment can go out to your own channel as well as
          ours. When you connect, we store a Google refresh token, your channel ID and your channel name. Nothing else.
        </p>
        <p>
          We use that access solely to create one scheduled live broadcast on your channel at your booked time and to
          obtain the stream endpoint we push to. We do not read, edit, publish or delete your existing videos,
          comments, captions, ratings or subscribers, and we never look at your analytics.
        </p>
        <p>
          Disconnecting from your dashboard deletes the token, the channel ID and the channel name immediately. You can
          also revoke us at any time from your Google account's security settings.
        </p>
        <p className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
          MilitaryVoice.ai's use and transfer of information received from Google APIs to any other app will adhere to
          the{" "}
          <a
            className="text-primary hover:underline"
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
      </Section>

      <Section heading="If you link your social accounts">
        <p>
          Linking the accounts you post from does two things: they show as follow buttons on your card in the public
          lineup, and they're where we can send clips from your segment. We store the platform, the handle and the
          public follower count the platform reports.
        </p>
        <p>
          Separately, and only if you switch it on in your dashboard, we ask a third-party service —{" "}
          <a className="text-primary hover:underline" href="https://influencers.club" target="_blank" rel="noreferrer">
            influencers.club
          </a>{" "}
          — for the public audience figures attached to those handles: follower counts, typical engagement, and
          aggregate audience makeup such as country and age bands. We pass it the handle and nothing else. It has no
          access to your accounts, and neither do we beyond what you granted for posting.
        </p>
        <p>
          Those figures are used to tell sponsors the size of the audience this event reaches. They are published as a
          combined total across the shows that opted in — never as a per-person list, and never attached to your name
          without asking you first. The switch is off until you turn it on, and turning it off stops your figures being
          counted from that moment.
        </p>
        <p className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
          A combined following is not the same as the number of distinct people, and we say so wherever we publish it.
          We will not present a sum as deduplicated reach.
        </p>
      </Section>

      <Section heading="What is public, and what is not">
        <p>
          Your show name, host name, photo, links and slot time appear on the public lineup — that is the point of
          booking one. Your email address, phone number and anything you write in the production notes stay with the
          production team and are never published.
        </p>
        <p>
          Stream keys and access tokens are stored server-side and are never sent back to a browser. Where we show one
          at all, we show the last four characters.
        </p>
      </Section>

      <Section heading="Who else touches it">
        <p>
          We use a small number of services to run the event, and share only what each needs:{" "}
          <strong className="text-foreground">LiveKit</strong> (live audio and video),{" "}
          <strong className="text-foreground">Cloudflare R2</strong> (recordings),{" "}
          <strong className="text-foreground">Supabase</strong> (database and uploaded material),{" "}
          <strong className="text-foreground">Vercel</strong> (hosting),{" "}
          <strong className="text-foreground">Resend</strong> (email), and{" "}
          <strong className="text-foreground">Upload-Post</strong> (only if you ask us to post something to your own
          social accounts).
        </p>
        <p>We do not sell your information, and we do not use it for advertising.</p>
      </Section>

      <Section heading="How long we keep it">
        <p>
          Your profile and bookings stay until you ask us to remove them. Recordings of your segment stay until you
          delete them or ask us to. Sign-in codes expire after fifteen minutes and are single-use.
        </p>
        <p>
          Ask us at {CONTACT} and we will delete your account, your bookings, your uploads and your recordings. We will
          confirm when it is done.
        </p>
      </Section>

      <Section heading="Children">
        <p>MilitaryVoice.ai is for adults. We do not knowingly collect information from anyone under 13.</p>
      </Section>

      <Section heading="Changes">
        <p>
          If we change this in a way that matters, we will email everyone with a booking rather than quietly updating
          the date at the top.
        </p>
      </Section>
    </Shell>
  );
}

export function TermsOfService() {
  return (
    <Shell title="Terms of service">
      <p className="text-base text-foreground">
        These are the terms for using MilitaryVoice.ai. Booking a slot or signing in means you accept them.
      </p>

      <Section heading="What the service is">
        <p>
          We run live, multi-speaker podcast events. You can book a slot, upload material for your segment, appear in
          our studio, and optionally send your segment to your own channels at the same time.
        </p>
        <p>
          Slots are free for podcasters at present. If that changes, it will not change for a booking you already hold.
        </p>
      </Section>

      <Section heading="Your content stays yours">
        <p>
          Everything you bring — your show, your recordings, your uploads — remains yours. You give us permission to
          broadcast, record and distribute your segment as part of the event, and to show your show's name, photo and
          links on the public lineup.
        </p>
        <p>
          You keep the recording of your own segment and can do whatever you like with it. We may use short excerpts to
          promote the event.
        </p>
      </Section>

      <Section heading="What you're responsible for">
        <p>
          That you have the right to broadcast what you bring — your own material, your guests' consent, and any music
          or clips you play. If a rights holder objects to something you played, that is yours to resolve.
        </p>
        <p>
          Keep it lawful and keep it civil. We will end a segment that becomes abusive, harassing, or is used to
          impersonate someone, and we may decline future bookings.
        </p>
      </Section>

      <Section heading="Live means live">
        <p>
          A live event can go wrong. Connections drop, cameras fail, platforms have outages. We will do our best —
          there is a standby clip and a producer watching — but we cannot promise your segment will air without
          interruption, and we are not liable for a slot that doesn't go to plan.
        </p>
        <p>
          If you don't appear for your slot, we will fill it. Tell us as early as you can and we will try to move you.
        </p>
      </Section>

      <Section heading="Your own channels">
        <p>
          If you connect YouTube or paste a stream key, you are asking us to broadcast to that account on your behalf
          during your slot. Their rules apply to you there as well as ours here, and a strike on your channel is
          between you and them.
        </p>
      </Section>

      <Section heading="Your audience figures">
        <p>
          If you switch on audience figures in your dashboard, you're letting us count the public follower and
          engagement numbers attached to your linked handles toward the combined audience we quote to sponsors, and to
          retrieve those numbers from a third-party data provider. You can switch it off at any time; we stop counting
          you from then on, though anything already printed or sent stays as it was printed.
        </p>
        <p>
          We publish combined totals, not lists of individuals, and we state the date the figures were read. We don't
          claim a sum of followings is a count of distinct people.
        </p>
      </Section>

      <Section heading="Ending it">
        <p>
          You can leave whenever you like — cancel your booking from your dashboard, or write to us and we will remove
          your account and everything in it. We may suspend access for anyone breaking the terms above.
        </p>
      </Section>

      <Section heading="The dull but necessary part">
        <p>
          The service is provided as it is, without warranty. To the extent the law allows, our liability to you is
          limited to what you have paid us, which for podcasters is currently nothing. These terms are governed by the
          law of the State of Ohio.
        </p>
      </Section>
    </Shell>
  );
}
