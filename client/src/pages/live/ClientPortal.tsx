import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ChevronLeft, LogOut } from "lucide-react";
import { useLive } from "./LiveApp";
import { assignable, CLIENT_ROLES, ROLE_LABEL, sideOf, STATUS_LABEL, useApprovals, useInvite, useMembers, useStages, type MemberRole, type Production } from "./api";
import { ApprovalRow } from "./Approvals";
import { FONT_BODY, FONT_COND, fmtRange } from "./ui";

/**
 * The client's portal at /live/<client> (plan decision 2): light, the client's name and logo, produced by
 * MilitaryVoices.ai. No controls, no crew, no internal notes. MV can open it to see exactly what the client sees.
 */
const TABS: { key: string; label: string; soon?: string }[] = [
  { key: "", label: "Overview" },
  { key: "schedule", label: "Schedule", soon: "Your run of show by day, with each session's speakers." },
  { key: "speakers", label: "Speakers", soon: "Speakers with bios, photos and how to say their names, for you to review." },
  { key: "approvals", label: "Approvals" },
  { key: "watch", label: "Watch", soon: "Links to watch on your channels and our watch page, ready to copy." },
  { key: "archive", label: "Archive", soon: "Every recording and clip after the event, by session and speaker." },
  { key: "reports", label: "Reports", soon: "Viewers by channel and session, and sponsor delivery." },
];

const INK = "#0d1b2e", MUTED = "#4f5d72", LINE = "#dde3ec";

export default function ClientPortal({ slug, tab = "", preview = false }: { slug: string; tab?: string; preview?: boolean }) {
  const { productions, current, email } = useLive();
  const mine = productions.filter((p) => p.org?.slug === slug);
  const p = mine.find((x) => x.id === current?.id) ?? mine[0] ?? (slug === "portal" ? current : null);
  const stageQ = useStages(p?.id ?? null);
  const t = TABS.find((x) => x.key === (tab ?? "")) ?? TABS[0];

  if (!p) {
    return (
      <Frame>
        <div className="pt-16" />
        <div className="mx-auto max-w-sm rounded-xl border bg-white p-5 text-center" style={{ borderColor: LINE }}>
          <p className="text-[17px] font-semibold">This page isn't here.</p>
          <p className="mt-2 text-[13px]" style={{ color: MUTED }}>Questions? Email <a className="font-semibold text-[#1f4f8f] hover:underline" href="mailto:hello@militaryvoices.ai">hello@militaryvoices.ai</a>.</p>
        </div>
      </Frame>
    );
  }
  const client = p.org;
  const stages = stageQ.data ?? [];

  return (
    <Frame>
      {preview && (
        <div className="flex h-9 items-center gap-2 bg-[#071a33] px-4 text-[13px] text-white">
          <Link href="/" className="flex items-center gap-1 font-semibold hover:underline"><ChevronLeft className="h-4 w-4" aria-hidden />Production Command</Link>
          <span className="text-[#a9b8cf]">· You're seeing the client's view, as {client?.name ?? "the client"} sees it.</span>
        </div>
      )}
      <header className="border-b bg-white" style={{ borderColor: LINE }}>
        <div className="mx-auto flex max-w-[1120px] items-center gap-3 px-4 py-3">
          {client?.logoUrl
            ? <img src={client.logoUrl} alt="" className="h-10 w-10 rounded-md object-contain" />
            : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-[15px] font-bold text-white" style={{ background: "#0b2447" }} aria-hidden>{initials(client?.name ?? p.name)}</span>}
          <div className="min-w-0">
            <p className="line-clamp-2 text-balance text-[19px] font-semibold leading-tight" style={{ fontFamily: FONT_COND }}>{p.name}</p>
            <p className="text-[12.5px]" style={{ color: MUTED }}>{client?.name ? `${client.name} · ` : ""}Produced by MilitaryVoices.ai</p>
          </div>
          {!preview && (
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden max-w-[220px] truncate text-[12.5px] sm:inline" style={{ color: MUTED }}>{email}</span>
              <button type="button" aria-label="Sign out" title="Sign out" className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-[#f3f5f9]" style={{ color: MUTED }}
                onClick={() => void fetch("/api/host/logout", { method: "POST", credentials: "include" }).finally(() => window.location.reload())}>
                <LogOut className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )}
        </div>
        <nav className="mx-auto flex max-w-[1120px] gap-1 overflow-x-auto px-3" aria-label="Portal">
          {TABS.map((x) => {
            const on = x.key === t.key;
            return (
              <Link key={x.key} href={`/${slug}${x.key ? `/${x.key}` : ""}`}
                className="whitespace-nowrap border-b-2 px-2.5 py-2 text-[14px] font-semibold"
                style={on ? { borderColor: "#0b2447", color: INK } : { borderColor: "transparent", color: MUTED }}
                data-testid={`portal-tab-${x.key || "overview"}`}>
                {x.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-[1120px] px-4 py-4">
        {t.key === "" && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="portal-overview">
            <Box title="Readiness">
              <p className="mb-1 text-[18px] font-semibold" style={{ fontFamily: FONT_COND }}>{STATUS_LABEL[p.status]}</p>
              <Line k="Dates" v={fmtRange(p.startsOn, p.endsOn)} />
              <Line k={stages.length > 1 ? "Stages" : "Stage"} v={stages.length ? stages.map((s) => s.name + (s.venue ? `, ${s.venue.name}` : "")).join(" · ") : "Being set up"} />
            </Box>
            <NeedsYou productionId={p.id} slug={slug} />
            <Team p={p} />
            <Box title="Watch links"><Soon>Links to watch on your channels and our watch page, ready to copy.</Soon></Box>
            <Box title="Schedule"><Soon>Your run of show by day, once the sessions are in.</Soon></Box>
            <Box title="After the event"><Soon>Recordings, clips and reports, delivered here.</Soon></Box>
            <Box title="Message the production team" className="md:col-span-3">
              <p className="text-[14px]" style={{ color: MUTED }}>Email <a className="font-semibold text-[#1f4f8f] hover:underline" href="mailto:hello@militaryvoices.ai">hello@militaryvoices.ai</a> and the MilitaryVoices.ai team will get back to you.</p>
            </Box>
          </div>
        )}
        {t.key === "approvals" && <ApprovalsTab productionId={p.id} />}
        {t.soon && <Box title={t.label}><Soon>{t.soon}</Soon></Box>}
      </main>
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return <div className="flow-root min-h-screen bg-[#f3f5f9]" style={{ color: INK, fontFamily: FONT_BODY }} data-testid="live-portal">{children}</div>;
}

function Box({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-lg border bg-white p-3.5 ${className}`} style={{ borderColor: LINE }}>
      <p className="mb-2 text-[13px] font-semibold uppercase" style={{ fontFamily: FONT_COND, letterSpacing: ".08em", color: MUTED }}>{title}</p>
      {children}
    </section>
  );
}
const Soon = ({ children }: { children: ReactNode }) => <p className="text-[13.5px]" style={{ color: MUTED }}>Coming soon. {children}</p>;
const Line = ({ k, v }: { k: string; v: ReactNode }) => (
  <div className="flex justify-between gap-3 border-b py-1.5 text-[13.5px] last:border-b-0" style={{ borderColor: LINE }}>
    <span style={{ color: MUTED }}>{k}</span><span className="min-w-0 truncate text-right font-medium">{v}</span>
  </div>
);
const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

function NeedsYou({ productionId, slug }: { productionId: number; slug: string }) {
  const q = useApprovals(productionId);
  const waiting = (q.data ?? []).filter((a) => a.mine);
  return (
    <Box title="Needs you">
      {waiting.length ? (
        <>
          <p className="text-[14px]">{waiting.length} waiting for your review.</p>
          <Link href={`/${slug}/approvals`} className="mt-2 inline-flex h-8 items-center rounded-md bg-[#0b2447] px-3 text-[13px] font-semibold text-white hover:bg-[#132e57]">Review</Link>
        </>
      ) : <p className="text-[13.5px]" style={{ color: MUTED }}>Nothing needs you right now.</p>}
    </Box>
  );
}

function ApprovalsTab({ productionId }: { productionId: number }) {
  const q = useApprovals(productionId);
  const rows = q.data ?? [];
  return (
    <Box title="Approvals">
      {rows.length ? rows.map((a) => <ApprovalRow key={a.id} a={a} light />) : <p className="text-[13.5px]" style={{ color: MUTED }}>{q.isLoading ? "Loading…" : "Nothing to approve yet. The run of show, speaker bios and clips come here for your OK."}</p>}
    </Box>
  );
}

/** The client's own people. A Client Admin can add reviewers and viewers; the server puts them in the admin's own org. */
function Team({ p }: { p: Production }) {
  const q = useMembers(p.id);
  const rows = (q.data ?? []).filter((m) => sideOf(m.role) === "client" && m.status !== "removed");
  const roles = assignable(p).filter((r) => CLIENT_ROLES.includes(r));
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<{ email: string; role: MemberRole }>({ email: "", role: "client_reviewer" });
  const [done, setDone] = useState("");
  const add = useInvite(p.id);
  const ok = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim());
  return (
    <Box title="Your team">
      {rows.slice(0, 4).map((m) => <Line key={m.id} k={m.name || m.email} v={m.status === "invited" ? "Invite saved" : ROLE_LABEL[m.role]} />)}
      {rows.length > 4 && <p className="pt-1 text-[12.5px]" style={{ color: MUTED }}>and {rows.length - 4} more</p>}
      {roles.length > 0 && !open && <button type="button" className="mt-2 text-[13px] font-semibold text-[#1f4f8f] hover:underline" onClick={() => setOpen(true)} data-testid="portal-add-person">Add a person</button>}
      {open && (
        <form className="mt-2 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (ok) add.mutate({ email: f.email.trim(), role: f.role }, { onSuccess: (m) => { setDone(`Invite saved for ${m.email}. We'll send it when invites are switched on.`); setF({ ...f, email: "" }); } }); }}>
          <div className="flex gap-2">
            <input type="email" value={f.email} onChange={(e) => { setF({ ...f, email: e.target.value }); setDone(""); }} placeholder="name@yourorg.org" className="h-9 min-w-0 flex-1 rounded-md border px-2.5 text-[14px] outline-none focus:ring-2 focus:ring-[#1f4f8f]/30" style={{ borderColor: LINE }} />
            <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as MemberRole })} className="h-9 rounded-md border px-2 text-[13.5px]" style={{ borderColor: LINE }} aria-label="Role">
              {roles.map((r) => <option key={r} value={r}>{r === "client_reviewer" ? "Reviewer" : "Viewer"}</option>)}
            </select>
          </div>
          <button type="submit" disabled={!ok || add.isPending} className="h-9 rounded-md bg-[#0b2447] text-[13.5px] font-semibold text-white hover:bg-[#132e57] disabled:opacity-50">{add.isPending ? "Saving…" : "Save invite"}</button>
          <p className="text-[12.5px]" style={{ color: add.error ? "#b42318" : done ? "#1d7a46" : MUTED }}>{add.error?.message ?? (done || "Reviewers can approve; viewers can only look.")}</p>
        </form>
      )}
    </Box>
  );
}
