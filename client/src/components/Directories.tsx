import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, Copy, Plus, Search, Star, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlatformIcon, platformLabel, formatFollowers } from "@/components/SocialIcons";
import { adminGet, adminSend } from "@/lib/adminApi";
import { resolveUploadUrl } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { SocialPlatform } from "@shared/schema";

/**
 * Admin → People → Directories (Andrew, 27 Nov 2026; the mockup in exports/directories-mockup/).
 * Directories are groups of members: All subscribers (team only), Verified podcasters and creators, and any made by
 * hand. Lists are the CRM's saved audiences, private, for emailing. Opening a directory shows its members with a
 * Public switch and a Featured star each.
 */

type Dir = { id: number; slug: string; name: string; description: string; kind: "all" | "verified" | "manual"; public: boolean; count: number; publicCount: number; faces: string[] };
type Member = { profileId: number; name: string; show: string; photoUrl: string; branch: string; serviceStatus: string; platforms: { platform: string; followers: number | null }[]; followers: number | null; public: boolean; featured: boolean; selfHidden?: boolean };
type Opened = { directory: Omit<Dir, "count" | "publicCount" | "faces">; members: Member[] };
type Audience = { key: string; label: string; count: number };

const NAVY = "#053877";
const PLATS: [SocialPlatform, string][] = [["youtube", "YouTube"], ["instagram", "Instagram"], ["tiktok", "TikTok"], ["x", "X"], ["facebook", "Facebook"], ["linkedin", "LinkedIn"]];
const asPlat = (p: string): SocialPlatform | null => {
  const k = p === "twitter" ? "x" : p;
  return (["instagram", "tiktok", "youtube", "x", "linkedin", "facebook", "threads"] as string[]).includes(k) ? (k as SocialPlatform) : null;
};
const navySwitch = "data-[state=checked]:bg-[#053877] dark:data-[state=checked]:bg-[#4f8fe0]";
const pageUrl = (slug: string) => `${window.location.origin.replace("://militaryvoices", "://www.militaryvoices")}/directory/${slug}`;

export function Directories() {
  const [open, setOpen] = useState<string | null>(null);
  return open ? <OneDirectory slug={open} onBack={() => setOpen(null)} /> : <AllDirectories onOpen={setOpen} />;
}

function Face({ url, size = 34 }: { url: string; size?: number }) {
  return url
    ? <img src={resolveUploadUrl(url)} alt="" className="shrink-0 rounded-full object-cover ring-2 ring-card" style={{ width: size, height: size }} />
    : <span className="shrink-0 rounded-full bg-gradient-to-br from-slate-200 to-slate-400 ring-2 ring-card dark:from-slate-600 dark:to-slate-800" style={{ width: size, height: size }} />;
}

function Chip({ tone = "plain", children }: { tone?: "plain" | "public" | "default" | "featured"; children: React.ReactNode }) {
  const cls = {
    plain: "border-border bg-card text-muted-foreground",
    public: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    default: "border-[#c9d6ec] bg-[#eef2f9] text-[#053877] dark:border-white/15 dark:bg-white/10 dark:text-white",
    featured: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  }[tone];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}

/* ------------------------------------------------------------------ every directory, and the Lists tab */

function AllDirectories({ onOpen }: { onOpen: (slug: string) => void }) {
  const [tab, setTab] = useState<"directories" | "lists">("directories");
  const [making, setMaking] = useState(false);
  const [, goTo] = useLocation();
  const dirs = useQuery<Dir[]>({ queryKey: ["/api/admin/directories"], queryFn: () => adminGet("/api/admin/directories") });
  const people = useQuery<{ audiences: Audience[] }>({ queryKey: ["/api/admin/people", 0], queryFn: () => adminGet("/api/admin/people"), enabled: tab === "lists", staleTime: 60_000 });
  const lists = (people.data?.audiences ?? []).filter((a) => a.key.startsWith("saved:"));
  const listCount = people.data ? lists.length : undefined;
  return (
    <section className="flex flex-col gap-3" data-testid="admin-directories">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold tracking-tight">Directories</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Groups of members. A public directory gets its own page on the site.</p>
        </div>
        {tab === "directories"
          ? <Button className="gap-1.5 rounded-full" onClick={() => setMaking(true)} data-testid="directory-new"><Plus className="h-4 w-4" />New directory</Button>
          : <Button className="gap-1.5 rounded-full" onClick={() => goTo("/admin/people?newList=1")} data-testid="list-new"><Plus className="h-4 w-4" />New list</Button>}
      </div>
      <div role="tablist" className="flex gap-5 border-b border-border text-sm font-semibold">
        {([["directories", "Directories", dirs.data?.length], ["lists", "Lists", listCount]] as const).map(([k, label, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`-mb-px border-b-2 py-2 ${tab === k ? "border-[#053877] text-[#053877] dark:border-[#8ab4f8] dark:text-[#8ab4f8]" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {label}{n != null && <span className="ml-1 font-medium text-muted-foreground">{n}</span>}
          </button>
        ))}
      </div>

      {tab === "directories" ? (
        <>
          {making && <NewDirectory onDone={(slug) => { setMaking(false); if (slug) onOpen(slug); }} />}
          {dirs.isError && <p className="text-sm text-destructive">Couldn't load the directories. Try again in a minute.</p>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(dirs.data ?? []).map((d) => (
              <button key={d.slug} type="button" onClick={() => onOpen(d.slug)} className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-[#053877]" data-testid={`directory-${d.slug}`}>
                <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">{d.name}{d.kind === "all" && <Chip tone="default">Default</Chip>}</span>
                <span className="flex items-center gap-2">
                  <span className="flex -space-x-2">{(d.faces.length ? d.faces : ["", "", ""]).slice(0, 4).map((f, i) => <Face key={i} url={f} size={26} />)}</span>
                  <span className="text-[13px] text-muted-foreground">{d.count} {d.kind === "all" ? (d.count === 1 ? "person" : "people") : d.count === 1 ? "member" : "members"}</span>
                  <span className="ml-auto">{d.kind === "all" ? <Chip>Team only</Chip> : d.public ? <Chip tone="public">Public</Chip> : <Chip>Private</Chip>}</span>
                </span>
                {d.description && <span className="text-[13px] leading-snug text-muted-foreground">{d.description}</span>}
              </button>
            ))}
            {dirs.data && (
              <button type="button" onClick={() => setMaking(true)} className="flex min-h-[104px] items-center justify-center rounded-2xl border-[1.5px] border-dashed border-border text-sm font-semibold text-[#053877] hover:border-[#053877] dark:text-[#8ab4f8]">
                <Plus className="mr-1 h-4 w-4" />New directory
              </button>
            )}
          </div>
          {!dirs.data && !dirs.isError && <p className="text-sm text-muted-foreground">Loading…</p>}
          <p className="text-xs text-muted-foreground">All subscribers and Verified fill themselves as people join. A new directory is hand-picked.</p>
        </>
      ) : (
        <>
          <p className="-mt-1 text-[13px] text-muted-foreground">Lists are private: for emailing and sorting people. Nobody outside the team sees them. Each one updates itself.</p>
          {people.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {people.data && !lists.length && <p className="text-sm text-muted-foreground">No lists yet. New list opens People: filter, then Save as list.</p>}
          {lists.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              {lists.map((l) => (
                <div key={l.key} className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0">
                  <span className="min-w-0 flex-1 truncate font-semibold">{l.label}</span>
                  <span className="whitespace-nowrap text-muted-foreground">{l.count} {l.count === 1 ? "person" : "people"}</span>
                  <button type="button" onClick={() => goTo(`/admin/people?list=${encodeURIComponent(l.key)}`)} className="font-semibold text-[#053877] hover:underline dark:text-[#8ab4f8]">Open</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function NewDirectory({ onDone }: { onDone: (slug?: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pub, setPub] = useState(false);
  const make = useMutation({
    mutationFn: async () => (await adminSend("POST", "/api/admin/directories", { name: name.trim(), description: description.trim(), public: pub })).json() as Promise<{ slug: string }>,
    onSuccess: (d) => { void qc.invalidateQueries({ queryKey: ["/api/admin/directories"] }); onDone(d.slug); },
  });
  return (
    <form className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4" onSubmit={(e) => { e.preventDefault(); if (name.trim().length >= 2) make.mutate(); }} data-testid="directory-form">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Directory name" aria-label="Directory name" />
        <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="Who it's for, in a line" aria-label="Description" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm"><Switch checked={pub} onCheckedChange={setPub} className={navySwitch} />Public page</label>
        <span className="ml-auto flex items-center gap-2">
          {make.error && <span className="text-[13px] text-destructive">{(make.error as Error).message}</span>}
          <Button type="button" variant="outline" className="rounded-full" onClick={() => onDone()}>Cancel</Button>
          <Button type="submit" className="rounded-full" disabled={name.trim().length < 2 || make.isPending}>{make.isPending ? "Making…" : "Make it"}</Button>
        </span>
      </div>
      <p className="text-xs text-muted-foreground">It starts empty: add members from inside it.</p>
    </form>
  );
}

/* ------------------------------------------------------------------ one directory opened */

function OneDirectory({ slug, onBack }: { slug: string; onBack: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = ["/api/admin/directories", slug];
  const q = useQuery<Opened>({ queryKey: key, queryFn: () => adminGet(`/api/admin/directories/${slug}`) });
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("");
  const [plat, setPlat] = useState<SocialPlatform | "">("");
  const [sort, setSort] = useState<"featured" | "followers" | "name">("featured");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);

  const d = q.data?.directory;
  const members = q.data?.members ?? [];
  const branches = useMemo(() => Array.from(new Set(members.map((m) => m.branch).filter(Boolean))).sort(), [members]);
  const shown = useMemo(() => {
    const n = search.trim().toLowerCase();
    const list = members.filter((m) =>
      (!n || `${m.name} ${m.show}`.toLowerCase().includes(n)) && (!branch || m.branch === branch) && (!plat || m.platforms.some((p) => asPlat(p.platform) === plat)));
    return [...list].sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name)
        : sort === "followers" ? (b.followers ?? 0) - (a.followers ?? 0)
          : Number(b.featured) - Number(a.featured) || (b.followers ?? 0) - (a.followers ?? 0));
  }, [members, search, branch, plat, sort]);

  // Switches answer at once; the server's answer settles it.
  const set = useMutation({
    mutationFn: async (v: { profileId: number; public?: boolean; featured?: boolean }) => adminSend("PATCH", `/api/admin/directories/${slug}/members/${v.profileId}`, { public: v.public, featured: v.featured }),
    onMutate: (v) => {
      const before = qc.getQueryData<Opened>(key);
      if (before) qc.setQueryData<Opened>(key, { ...before, members: before.members.map((m) => (m.profileId === v.profileId ? { ...m, ...(v.public === undefined ? {} : { public: v.public }), ...(v.featured === undefined ? {} : { featured: v.featured }) } : m)) });
      return { before };
    },
    onError: (e, _v, ctx) => { if (ctx?.before) qc.setQueryData(key, ctx.before); toast({ title: "Couldn't change that", description: (e as Error).message, variant: "destructive" }); },
    onSettled: () => { void qc.invalidateQueries({ queryKey: ["/api/admin/directories"] }); },
  });
  const remove = useMutation({
    mutationFn: async (profileId: number) => adminSend("DELETE", `/api/admin/directories/${slug}/members/${profileId}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["/api/admin/directories"] }); },
  });
  const patchDir = useMutation({
    mutationFn: async (b: { name?: string; description?: string; public?: boolean }) => adminSend("PATCH", `/api/admin/directories/${slug}`, b),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["/api/admin/directories"] }); setEditing(false); },
  });
  const drop = useMutation({
    mutationFn: async () => adminSend("DELETE", `/api/admin/directories/${slug}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["/api/admin/directories"] }); onBack(); },
  });

  const all = d?.kind === "all";
  const manual = d?.kind === "manual";
  const pubCount = members.filter((m) => m.public).length;
  const featCount = members.filter((m) => m.featured).length;
  const copy = async () => {
    try { await navigator.clipboard.writeText(pageUrl(slug)); toast({ title: "Link copied" }); } catch { toast({ title: "Couldn't copy", description: pageUrl(slug) }); }
  };

  return (
    <section className="flex flex-col gap-3" data-testid={`admin-directory-${slug}`}>
      <button type="button" onClick={onBack} className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-[#053877] hover:underline dark:text-[#8ab4f8]"><ArrowLeft className="h-4 w-4" />Directories</button>
      {!d ? <p className="text-sm text-muted-foreground">{q.isError ? "Couldn't open it. Try again in a minute." : "Loading…"}</p> : (
        <>
          {editing ? (
            <EditDirectory d={d} busy={patchDir.isPending} error={patchDir.error as Error | null} onSave={(b) => patchDir.mutate(b)} onCancel={() => setEditing(false)}
              onDelete={() => { if (window.confirm(`Delete "${d.name}"? Its members stay in People; only this directory goes.`)) drop.mutate(); }} />
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-balance text-xl font-bold tracking-tight">{d.name}</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {d.description}{d.description ? " " : ""}
                  {all ? "Its Public switch is each member's own Member Directory setting." : d.public ? <>Public at <span className="[overflow-wrap:anywhere]">{pageUrl(slug).replace(/^https?:\/\//, "")}</span></> : "Private: no page on the site."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!all && <label className="flex items-center gap-2 text-sm font-medium"><Switch checked={d.public} disabled={patchDir.isPending} onCheckedChange={(v) => patchDir.mutate({ public: v })} className={navySwitch} />Public page</label>}
                {!all && d.public && <Button variant="outline" size="sm" className="gap-1.5 rounded-full" onClick={copy}><Copy className="h-3.5 w-3.5" />Copy link</Button>}
                {manual && <Button variant="outline" size="sm" className="rounded-full" onClick={() => setEditing(true)}>Edit</Button>}
                {manual && <Button size="sm" className="gap-1.5 rounded-full" onClick={() => setAdding((v) => !v)} data-testid="directory-add-members"><Plus className="h-4 w-4" />Add members</Button>}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Chip>{members.length} {all ? "people" : "members"}</Chip>
            <Chip tone="public">{pubCount} public</Chip>
            <Chip>{members.length - pubCount} hidden</Chip>
            {featCount > 0 && <Chip tone="featured">★ {featCount} featured</Chip>}
          </div>
          {adding && manual && <AddMembers slug={slug} have={new Set(members.map((m) => m.profileId))} onDone={() => setAdding(false)} />}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or show" className="h-9 rounded-full pl-9" aria-label="Search members" />
            </div>
            <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch" className="hidden h-9 rounded-full border border-input bg-card px-3 text-sm sm:block">
              <option value="">All branches</option>
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort" className="hidden h-9 rounded-full border border-input bg-card px-3 text-sm sm:block">
              <option value="featured">Featured first</option>
              <option value="followers">Most followers</option>
              <option value="name">Name</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {([["", "All"], ...PLATS] as [SocialPlatform | "", string][]).map(([k, label]) => (
              <button key={label} type="button" onClick={() => setPlat(k)} aria-pressed={plat === k}
                className={`rounded-full border px-3 py-0.5 text-[12.5px] font-semibold ${plat === k ? "border-[#053877] bg-[#053877] text-white" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}>{label}</button>
            ))}
          </div>

          {!shown.length ? (
            <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              {members.length ? "Nobody matches that." : manual ? "Nobody in it yet. Add members to start." : "Nobody yet. It fills itself as people join."}
            </p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1.3fr)_90px_64px_70px_40px] items-center gap-3 border-b border-border bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground md:grid">
                <span>Member</span><span>Platforms</span><span>Branch</span><span className="text-right">Followers</span><span>Public</span><span>Featured</span><span />
              </div>
              {shown.map((m) => (
                <div key={m.profileId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2.5 last:border-b-0 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1.3fr)_90px_64px_70px_40px]" data-testid={`directory-member-${m.profileId}`}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Face url={m.photoUrl} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{m.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{!all && m.selfHidden ? "Hidden by them · " : ""}{m.show || "No show yet"}<span className="md:hidden">{m.branch ? ` · ${m.branch}` : ""}</span></p>
                    </div>
                  </div>
                  {/* Phone: the star and switch sit on the right of the name. */}
                  <div className="flex items-center gap-3 md:hidden">
                    <StarButton on={m.featured} onClick={() => set.mutate({ profileId: m.profileId, featured: !m.featured })} />
                    <Switch checked={m.public} disabled={!all && !!m.selfHidden} title={!all && m.selfHidden ? "They've hidden themselves from directories on their Profile" : undefined} onCheckedChange={(v) => set.mutate({ profileId: m.profileId, public: v })} className={navySwitch} aria-label={`Public: ${m.name}`} />
                  </div>
                  <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 pl-[44px] text-xs text-muted-foreground md:col-span-1 md:pl-0">
                    {m.platforms.map((p) => { const k = asPlat(p.platform); return k ? <span key={p.platform} className="inline-flex items-center gap-1 whitespace-nowrap" title={platformLabel(k)}><PlatformIcon platform={k} className="h-3.5 w-3.5" />{formatFollowers(p.followers ?? undefined) ?? ""}</span> : null; })}
                    {!m.platforms.length && <span>—</span>}
                    <span className="md:hidden">{m.followers ? `· ${formatFollowers(m.followers)} followers` : ""}</span>
                  </div>
                  <div className="hidden min-w-0 flex-wrap items-center gap-1 md:flex">
                    {m.branch ? <span className="whitespace-nowrap rounded-full bg-[#eef2f9] px-2 py-0.5 text-[11.5px] font-semibold text-[#053877] dark:bg-white/10 dark:text-white">{m.branch}</span> : <span className="text-xs text-muted-foreground">—</span>}
                    {m.serviceStatus && <span className="whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-[11.5px] font-semibold text-muted-foreground">{m.serviceStatus}</span>}
                  </div>
                  <span className="hidden text-right text-sm font-semibold tabular-nums md:block">{m.followers ? formatFollowers(m.followers) : "—"}</span>
                  <span className="hidden md:block"><Switch checked={m.public} disabled={!all && !!m.selfHidden} title={!all && m.selfHidden ? "They've hidden themselves from directories on their Profile" : undefined} onCheckedChange={(v) => set.mutate({ profileId: m.profileId, public: v })} className={navySwitch} aria-label={`Public: ${m.name}`} /></span>
                  <span className="hidden md:block"><StarButton on={m.featured} onClick={() => set.mutate({ profileId: m.profileId, featured: !m.featured })} /></span>
                  <span className="hidden justify-end md:flex">
                    {manual && <button type="button" title="Take out of this directory" onClick={() => remove.mutate(m.profileId)} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Trash2 className="h-4 w-4" /></button>}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {all ? "Public: on the Member Directory at militaryvoices.ai/directory; members can switch it themselves on their Profile. Featured: shown first." : "Public: shown on this directory's page. Featured: shown first. Hidden members stay in the directory, just not on the page."}
          </p>
        </>
      )}
    </section>
  );
}

function StarButton({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} title={on ? "Featured: shown first" : "Feature them"} className="rounded-full p-1 hover:bg-muted">
      <Star className={`h-[18px] w-[18px] ${on ? "fill-[#F0A71F] text-[#F0A71F]" : "text-slate-300 dark:text-slate-600"}`} />
    </button>
  );
}

function EditDirectory({ d, busy, error, onSave, onCancel, onDelete }: { d: { name: string; description: string }; busy: boolean; error: Error | null; onSave: (b: { name: string; description: string }) => void; onCancel: () => void; onDelete: () => void }) {
  const [name, setName] = useState(d.name);
  const [description, setDescription] = useState(d.description);
  return (
    <form className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4" onSubmit={(e) => { e.preventDefault(); onSave({ name: name.trim(), description: description.trim() }); }}>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Directory name" />
        <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="Who it's for, in a line" aria-label="Description" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onDelete} className="text-sm font-semibold text-destructive hover:underline">Delete directory</button>
        <span className="ml-auto flex items-center gap-2">
          {error && <span className="text-[13px] text-destructive">{error.message}</span>}
          <Button type="button" variant="outline" className="rounded-full" onClick={onCancel}>Cancel</Button>
          <Button type="submit" className="rounded-full" disabled={busy || name.trim().length < 2}>{busy ? "Saving…" : "Save"}</Button>
        </span>
      </div>
    </form>
  );
}

function AddMembers({ slug, have, onDone }: { slug: string; have: Set<number>; onDone: () => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const found = useQuery<{ profileId: number; name: string; show: string; photoUrl: string }[]>({
    queryKey: ["/api/admin/directories-people", q],
    queryFn: () => adminGet(`/api/admin/directories-people?q=${encodeURIComponent(q.trim())}`),
  });
  const add = useMutation({
    mutationFn: async () => adminSend("POST", `/api/admin/directories/${slug}/members`, { profileIds: Array.from(picked) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["/api/admin/directories"] }); onDone(); },
  });
  const list = (found.data ?? []).filter((p) => !have.has(p.profileId));
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find people by name or show" className="h-9 rounded-full pl-9" aria-label="Find people" />
      </div>
      <div className="max-h-64 overflow-y-auto">
        {list.map((p) => (
          <label key={p.profileId} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted">
            <input type="checkbox" checked={picked.has(p.profileId)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(p.profileId); else n.delete(p.profileId); return n; })} className="h-4 w-4 accent-[#053877]" />
            <Face url={p.photoUrl} size={28} />
            <span className="min-w-0 flex-1 truncate text-sm"><b className="font-semibold">{p.name}</b>{p.show ? <span className="text-muted-foreground"> · {p.show}</span> : null}</span>
          </label>
        ))}
        {found.data && !list.length && <p className="px-2 py-2 text-sm text-muted-foreground">Nobody else matches.</p>}
      </div>
      <div className="flex items-center justify-end gap-2">
        {add.error && <span className="text-[13px] text-destructive">{(add.error as Error).message}</span>}
        <Button variant="outline" className="rounded-full" onClick={onDone}>Cancel</Button>
        <Button className="rounded-full" disabled={!picked.size || add.isPending} onClick={() => add.mutate()}>{add.isPending ? "Adding…" : `Add ${picked.size || ""}`.trim()}</Button>
      </div>
    </div>
  );
}
