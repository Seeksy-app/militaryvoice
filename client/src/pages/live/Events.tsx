import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ChevronLeft } from "lucide-react";
import { useLive } from "./LiveApp";
import { can, effectiveRole, STATUS_LABEL, STATUSES, useLiveWrite, useProduction, useVenues, type Production, type Stage, type Status, type Venue } from "./api";
import { Btn, C, Card, Field, FONT_COND, fmtRange, Input, LinkBtn, Row, Select } from "./ui";

/** Events: every production this person can see, and one production's details, venues and stages. */
export default function Events() {
  const { productions, isAdmin, setCurrent } = useLive();
  const [, go] = useLocation();
  return (
    <div className="flex flex-col gap-3" data-testid="live-events">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[24px] font-semibold leading-none" style={{ fontFamily: FONT_COND }}>Events</h1>
        {isAdmin && <LinkBtn primary href="/events/new" testId="live-new-production">New production</LinkBtn>}
      </div>
      <div className="overflow-hidden rounded-lg border" style={{ borderColor: C.line, background: C.card }}>
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="border-b" style={{ borderColor: C.line }}>
              {["Production", "Client", "Dates", "Stage of work", "Stages", "People"].map((h) => (
                <th key={h} className="px-3 py-2 text-[12px] font-semibold uppercase" style={{ fontFamily: FONT_COND, letterSpacing: ".08em", color: C.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {productions.map((p) => (
              <tr
                key={p.id}
                className="cursor-pointer border-b last:border-b-0 hover:bg-white/5"
                style={{ borderColor: C.line }}
                onClick={() => { setCurrent(p.id); go(`/events/${p.id}`); }}
                data-testid={`live-event-row-${p.id}`}
              >
                <td className="max-w-[320px] truncate px-3 py-2 font-semibold">{p.name}</td>
                <td className="px-3 py-2" style={{ color: C.muted }}>{p.client?.name ?? "Not set"}</td>
                <td className="whitespace-nowrap px-3 py-2" style={{ color: C.muted }}>{fmtRange(p.starts_on, p.ends_on)}</td>
                <td className="px-3 py-2">{STATUS_LABEL[p.status]}</td>
                <td className="px-3 py-2 tabular-nums">{p.stage_count}</td>
                <td className="px-3 py-2 tabular-nums">{p.member_count}</td>
              </tr>
            ))}
            {!productions.length && <tr><td colSpan={6} className="px-3 py-4" style={{ color: C.muted }}>No productions yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ZONES: [string, string][] = [
  ["America/New_York", "Eastern"], ["America/Chicago", "Central"], ["America/Denver", "Mountain"], ["America/Phoenix", "Arizona"],
  ["America/Los_Angeles", "Pacific"], ["America/Anchorage", "Alaska"], ["Pacific/Honolulu", "Hawaii"],
];
const zoneName = (z: string) => ZONES.find(([k]) => k === z)?.[1] ?? z;

/** One production: details on the left, stages and venues on the right. id null = a new production. */
export function EventEdit({ id }: { id: number | null }) {
  const { isAdmin, setCurrent, productions } = useLive();
  const [, go] = useLocation();
  const detail = useProduction(id);
  const p = detail.data;
  const role = effectiveRole(productions.find((x) => x.id === id) ?? null, isAdmin);
  const editable = id === null ? isAdmin : can.editProduction(role);
  useEffect(() => { if (id) setCurrent(id); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [f, setF] = useState({ name: "", client_name: "", starts_on: "", ends_on: "", timezone: "America/New_York", status: "scoping" as Status, scope: "" });
  useEffect(() => { if (p) setF({ name: p.name, client_name: p.client?.name ?? "", starts_on: p.starts_on, ends_on: p.ends_on, timezone: p.timezone, status: p.status, scope: p.scope }); }, [p]);
  const create = useLiveWrite<typeof f, Production>("POST", () => "/productions");
  const save = useLiveWrite<Partial<typeof f>, Production>("PATCH", () => `/productions/${id}`);
  const [saved, setSaved] = useState(false);
  const busy = create.isPending || save.isPending;
  const err = create.error?.message ?? save.error?.message;
  const dirty = !p || f.name !== p.name || f.starts_on !== p.starts_on || f.ends_on !== p.ends_on || f.timezone !== p.timezone || f.status !== p.status || f.scope !== p.scope;
  const datesBad = !!f.starts_on && !!f.ends_on && f.ends_on < f.starts_on;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim() || datesBad) return;
    if (id === null) {
      create.mutate(f, { onSuccess: (np) => { setCurrent(np.id); go(`/events/${np.id}`); } });
    } else {
      const { client_name: _c, ...rest } = f;
      save.mutate(rest, { onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2500); } });
    }
  };

  if (id !== null && detail.isLoading) return <p style={{ color: C.muted }}>Loading…</p>;
  if (id !== null && (detail.error || !p)) return <p style={{ color: C.muted }}>{detail.error?.message ?? "That production isn't here."}</p>;

  return (
    <div className="flex flex-col gap-3" data-testid="live-event-edit">
      <div className="flex items-center gap-2">
        <Link href="/events" className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/5" aria-label="Back to Events"><ChevronLeft className="h-5 w-5" aria-hidden /></Link>
        <h1 className="min-w-0 truncate text-[24px] font-semibold leading-none" style={{ fontFamily: FONT_COND }}>{id === null ? "New production" : p!.name}</h1>
      </div>
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card title="Details">
          {editable ? (
            <form onSubmit={submit} className="grid grid-cols-2 gap-x-3 gap-y-2.5">
              <div className="col-span-2"><Field label="Production name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="National Convention · Exhibit Hall Stage" required maxLength={120} data-testid="live-f-name" /></Field></div>
              <div className="col-span-2">
                {id === null
                  ? <Field label="Client organisation"><Input value={f.client_name} onChange={(e) => setF({ ...f, client_name: e.target.value })} placeholder="The client's name, as on the contract" maxLength={120} data-testid="live-f-client" /></Field>
                  : <Row label="Client">{p!.client?.name ?? "Not set"}</Row>}
              </div>
              <Field label="First show day"><Input type="date" value={f.starts_on} onChange={(e) => setF({ ...f, starts_on: e.target.value })} /></Field>
              <Field label="Last show day"><Input type="date" value={f.ends_on} min={f.starts_on || undefined} onChange={(e) => setF({ ...f, ends_on: e.target.value })} /></Field>
              <Field label="Time zone"><Select value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>{ZONES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              {id !== null
                ? <Field label="Stage of work"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Status })}>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select></Field>
                : <span />}
              <div className="col-span-2"><Field label="Scope"><Input value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} placeholder="Stages, cameras, destinations, deliverables" maxLength={300} /></Field></div>
              <div className="col-span-2 flex items-center gap-3 pt-1">
                <Btn primary type="submit" disabled={busy || !f.name.trim() || datesBad || (id !== null && !dirty)} data-testid="live-f-save">{busy ? "Saving…" : id === null ? "Create production" : "Save changes"}</Btn>
                <span className="text-[13px]" style={{ color: err || datesBad ? "#ff8a80" : C.muted }}>{datesBad ? "The last day is before the first." : err ?? (saved ? "Saved." : "")}</span>
              </div>
            </form>
          ) : (
            <>
              <Row label="Client">{p!.client?.name ?? "Not set"}</Row>
              <Row label="Dates">{fmtRange(p!.starts_on, p!.ends_on)}</Row>
              <Row label="Time zone">{zoneName(p!.timezone)}</Row>
              <Row label="Stage of work">{STATUS_LABEL[p!.status]}</Row>
              {p!.scope && <Row label="Scope">{p!.scope}</Row>}
            </>
          )}
        </Card>
        {id !== null && <Stages productionId={id} stages={p!.stages} venues={p!.venues} editable={editable} />}
      </div>
    </div>
  );
}

function Stages({ productionId, stages, venues, editable }: { productionId: number; stages: Stage[]; venues: Venue[]; editable: boolean }) {
  const all = useVenues();
  const known = all.data ?? venues;
  const venueOf = (vid: number | null) => known.find((v) => v.id === vid);
  const [name, setName] = useState("");
  const [venue, setVenue] = useState<string>("");
  const [nv, setNv] = useState({ name: "", city: "", state: "" });
  const addVenue = useLiveWrite<typeof nv, Venue>("POST", () => "/venues");
  const addStage = useLiveWrite<{ name: string; venue_id: number | null }, Stage>("POST", () => `/productions/${productionId}/stages`);
  const busy = addVenue.isPending || addStage.isPending;
  const err = addVenue.error?.message ?? addStage.error?.message;
  const isNew = venue === "new";
  const ready = name.trim() && (!isNew || nv.name.trim());

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    let venueId: number | null = venue && !isNew ? Number(venue) : null;
    if (isNew) venueId = (await addVenue.mutateAsync(nv).catch(() => null))?.id ?? null;
    if (isNew && !venueId) return;
    addStage.mutate({ name: name.trim(), venue_id: venueId }, { onSuccess: () => { setName(""); setVenue(""); setNv({ name: "", city: "", state: "" }); } });
  };

  return (
    <Card title="Stages and venues" testId="live-stages">
      {stages.length ? stages.map((s) => {
        const v = venueOf(s.venue_id);
        return <Row key={s.id} label={<span className="font-semibold" style={{ color: C.ink }}>{s.name}</span>}>{v ? `${v.name}${v.city ? `, ${v.city}` : ""}${v.state ? `, ${v.state}` : ""}` : "No venue"}</Row>;
      }) : <p className="text-[13.5px]" style={{ color: C.muted }}>No stage yet.</p>}
      {editable && (
        <form onSubmit={add} className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 border-t pt-3" style={{ borderColor: C.line }}>
          <Field label="Stage name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Exhibit Hall Stage" maxLength={80} data-testid="live-stage-name" /></Field>
          <Field label="Venue">
            <Select value={venue} onChange={(e) => setVenue(e.target.value)} data-testid="live-stage-venue">
              <option value="">Pick a venue</option>
              {known.map((v) => <option key={v.id} value={v.id}>{v.name}{v.city ? `, ${v.city}` : ""}</option>)}
              <option value="new">New venue…</option>
            </Select>
          </Field>
          {isNew && (
            <div className="col-span-2 grid grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,.6fr)] gap-2">
              <Field label="Venue name"><Input value={nv.name} onChange={(e) => setNv({ ...nv, name: e.target.value })} placeholder="Convention center" maxLength={120} /></Field>
              <Field label="City"><Input value={nv.city} onChange={(e) => setNv({ ...nv, city: e.target.value })} maxLength={80} /></Field>
              <Field label="State"><Input value={nv.state} onChange={(e) => setNv({ ...nv, state: e.target.value.toUpperCase().slice(0, 2) })} maxLength={2} /></Field>
            </div>
          )}
          <div className="col-span-2 flex items-center gap-3">
            <Btn type="submit" disabled={busy || !ready} data-testid="live-stage-add">{busy ? "Adding…" : "Add stage"}</Btn>
            {err && <span className="text-[13px] text-[#ff8a80]">{err}</span>}
          </div>
        </form>
      )}
    </Card>
  );
}
