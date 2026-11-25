import { useEffect } from "react";
import { Link } from "wouter";
import { NavBar } from "@/components/NavBar";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

// About us (Andrew, 25 Nov 2026: "Add an about us page highlighting Riccoh Player"; the draft approved with
// "Yes, publish it"). Facts are from Riccoh's own SmartLink bio, his feed and the PodcastOne release of 5 Oct 2026;
// the quote is his, from that release. The product tour stays at /platform.
export default function AboutUs() {
  useEffect(() => {
    document.title = "About us — MilitaryVoices.ai";
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <NavBar />

      <header className="bg-[#000741] text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:py-20">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#F0A71F]">About us</p>
            <h1 className="mt-4 text-balance text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl" style={HEADLINE_FONT}>
              Riccoh Player
            </h1>
            <h2 className="mt-4 max-w-xl text-balance text-xl font-semibold leading-snug text-white sm:text-2xl" style={HEADLINE_FONT}>
              Founding &amp; Operating Partner of MilitaryVoices.ai
            </h2>
          </div>
          <div className="overflow-hidden rounded-3xl border border-white/10 shadow-2xl">
            <img
              src="/riccoh-player-suit.jpg"
              alt="Colonel Riccoh Player, USMC (Ret.)"
              className="aspect-[4/5] h-full w-full object-cover"
            />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-14 sm:px-6" data-testid="about-us">
        <article className="flex flex-col gap-6 text-[17px] leading-relaxed text-foreground">
          <div>
            <h2 className="text-balance text-3xl font-bold leading-tight tracking-tight sm:text-4xl" style={HEADLINE_FONT}>
              Riccoh Player
            </h2>
            <p className="mt-2 text-balance text-xl font-semibold leading-snug sm:text-2xl" style={HEADLINE_FONT}>
              Founding &amp; Operating Partner of MilitaryVoices.ai
            </p>
            <p className="mt-2 text-pretty text-lg font-medium text-muted-foreground">
              Col, USMC (ret), founder of OHIOWA Management Group LLC.
            </p>
          </div>
          <p className="text-pretty">
            Riccoh served thirty-three years in the United States Marine Corps, with five combat tours across
            Operations Desert Shield, Desert Storm, Shining Hope, Iraqi Freedom and Enduring Freedom. An East
            Cleveland, Ohio native, he retired as a Colonel.
          </p>
          <p className="text-pretty">
            When he took off the uniform, he kept the mission: telling the stories of the people he served with. An
            Ithaca College alumnus, he is a 2019 Emmy Award winner, a Gold Telly Award winner and a documentary
            filmmaker. Over the past three years he has been deeply involved in podcasting, TV management, and content
            aggregation and distribution.
          </p>
          <p className="text-pretty">
            He served as Dr. Phil&rsquo;s Chief of Staff at Merit Street Media from 2024
            to 2025. Today he is Chief of Staff at Envoy Media, and he has been a brand ambassador for the Military
            Basketball Association since 2023.
          </p>
          <p className="text-pretty">
            Riccoh was a founding partner of National Military Podcast Day, held every October 5, just before the anniversary of the start
            of Operation Enduring Freedom. In 2026 he hosted the first Military Podcast Marathon: sixteen hours,
            thirty-two military and veteran podcasters, handed off live every thirty minutes on MilitaryVoices.ai. The
            same year he brought PodcastOne on as a multi-year distribution, content and marketing partner.
          </p>
          <p className="text-pretty">
            He hosts Warriors&rsquo; Voice, and co-hosts the WARRIOR Legacy Network podcast, which helps service
            members make the move from active duty to civilian life.
          </p>

          <figure className="my-4 rounded-3xl bg-[#000741] px-7 py-8 text-white sm:px-10">
            <blockquote className="text-balance text-2xl font-semibold leading-snug sm:text-3xl" style={HEADLINE_FONT}>
              &ldquo;Every veteran has a story that someone out there needs to hear.&rdquo;
            </blockquote>
            <figcaption className="mt-4 text-sm font-medium text-[#F0A71F]">Colonel Riccoh Player, USMC (Ret.)</figcaption>
          </figure>

          <p className="text-pretty">In his own words:</p>
          <blockquote className="border-l-0 text-pretty text-lg italic leading-relaxed text-foreground/85">
            &ldquo;I want to win! I want to professionally and personally champion a team of growth-minded and
            innovative content creators who are inspired by amplifying military content, motivated by innovation and
            focused on influencing positivity worldwide.&rdquo;
          </blockquote>

          <h2 className="mt-4 text-balance text-2xl font-bold tracking-tight sm:text-3xl" style={HEADLINE_FONT}>
            The company
          </h2>
          <p className="text-pretty">
            MilitaryVoices.ai is operated by OHIOWA Management Group LLC and powered by Applied Growth Technologies.
            It&rsquo;s one home where military and veteran creators record, go live, publish their podcast and grow
            their audience.
          </p>
        </article>

        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link href="/host/dashboard">
            <Button size="lg" className="h-12 bg-[#F0A71F] px-7 text-base font-bold text-[#1a1200] hover:bg-[#e09a10]" data-testid="about-start">
              Start your show free
            </Button>
          </Link>
          <a href="mailto:hello@militaryvoices.ai">
            <Button size="lg" variant="outline" className="h-12 px-7 text-base font-semibold" data-testid="about-contact">
              Contact us
            </Button>
          </a>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
