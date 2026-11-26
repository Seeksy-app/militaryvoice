import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ChevronLeft } from "lucide-react";
import { useLive } from "./LiveApp";
import { sideOf, STATUS_LABEL, STATUSES, useAddStage, useAddVenue, useCreateProduction, useOrgs, usePatchOrg, usePatchProduction, useProduction, useStages, useVenues, type LiveOrg, type Stage, type Status } from "./api";
import { brand, Btn, C, Card, Field, FONT_COND, fmtRange, initials, Input, LinkBtn, Row, Select } from "./ui";

/** Events: every production this person can see, and one production's details, stages and venues. */
export default function Events() {
  const { productions, isAdmin, setCurrent } = useLive();
  const [, go] = useLocation();
  return (
    <div className="flex flex-col gap-3" data-testid="live-events">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[24px] font-semibold leading-none" style={{ fontFamily: FONT_COND }}>Events</h1>
        {isAdmin && <LinkBtn primary href="/events/new" testId="live-new-production">New production</LinkBtn>}
      </div>
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: C.line, background: C.card }}>
        <table className="w-full min-w-[640px] text-left text-[13.5px]">
          <thead>
            <tr className="border-b" style={{ borderColor: C.line }}>
              {["Production", "Client", "Dates", "Stage of work", "Stages", "People"].map((h) => (
                <th key={h} className="px-3 py-2 text-[12px] font-semibold uppercase" style={{ fontFamily: FONT_COND, letterSpacing: ".08em", color: C.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {productions.map((p) => (
              <tr key={p.id} className="cursor-pointer border-b last:border-b-0 hover:bg-white/5" style={{ borderColor: C.line }}
                onClick={() => { setCurrent(p.id); go(`/events/${p.id}`); }} data-testid={`live-event-row-${p.id}`}>
                <td className="max-w-[320px] truncate px-3 py-2 font-semibold">{p.name}</td>
                <td className="px-3 py-2" style={{ color: C.muted }}>{p.org?.name ?? "Not set"}</td>
                <td className="whitespace-nowrap px-3 py-2" style={{ color: C.muted }}>{fmtRange(p.startsOn, p.endsOn)}</td>
                <td className="px-3 py-2">{STATUS_LABEL[p.status]}</td>
                <td className="px-3 py-2 tabular-nums">{p.stageCount}</td>
                <td className="px-3 py-2 tabular-nums">{p.memberCount}</td>
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
const NEW = "new";

/** One production: details on the left, stages and venues on the right. id null = a new production (platform admins). */
export function EventEdit({ id }: { id: number | null }) {
  const { isAdmin, setCurrent } = useLive();
  const [, go] = useLocation();
  const detail = useProduction(id);
  const p = detail.data;
  const editable = id === null ? isAdmin : !!p?.can.edit;
  useEffect(() => { if (id) setCurrent(id); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const clients = useOrgs("client", id === null && isAdmin);
  const [f, setF] = useState({ name: "", startsOn: "", endsOn: "", timezone: "America/New_York", status: "scoping" as Status, scope: "" });
  const [org, setOrg] = useState<string>(""); // an org id, NEW, or "" for none
  const [orgName, setOrgName] = useState("");
  useEffect(() => { if (p) setF({ name: p.name, startsOn: p.startsOn, endsOn: p.endsOn, timezone: p.timezone, status: p.status, scope: p.scope }); }, [p]);
  const create = useCreateProduction();
  const save = usePatchProduction(id ?? 0);
  const [saved, setSaved] = useState(false);
  const busy = create.isPending || save.isPending;
  const err = create.error?.message ?? save.error?.message;
  const dirty = !p || f.name !== p.name || f.startsOn !== p.startsOn || f.endsOn !== p.endsOn || f.timezone !== p.timezone || f.status !== p.status || f.scope !== p.scope;
  const datesBad = !!f.startsOn && !!f.endsOn && f.endsOn < f.startsOn;
  const ready = f.name.trim().length >= 2 && !datesBad && (org !== NEW || orgName.trim());

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    if (id === null) {
      const { status: _s, ...rest } = f;
      const who = org === NEW ? { newOrg: { name: orgName.trim() } } : org ? { orgId: Number(org) } : {};
      create.mutate({ ...rest, name: f.name.trim(), ...who }, { onSuccess: (np) => { setCurrent(np.id); go(`/events/${np.id}`); } });
    } else {
      save.mutate({ ...f, name: f.name.trim() }, { onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2500); } });
    }
  };

  if (id !== null && detail.isLoading) return <p style={{ color: C.muted }}>Loading…</p>;
  if (id !== null && (detail.error || !p)) return <p style={{ color: C.muted }}>{detail.error?.status === 404 ? "That production isn't here." : detail.error?.message ?? "That production isn't here."}</p>;

  return (
    <div className="flex flex-col gap-3" data-testid="live-event-edit">
      <div className="flex items-center gap-2">
        <Link href="/events" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-white/5" aria-label="Back to Events"><ChevronLeft className="h-5 w-5" aria-hidden /></Link>
        <h1 className="min-w-0 truncate text-[24px] font-semibold leading-none" style={{ fontFamily: FONT_COND }}>{id === null ? "New production" : p!.name}</h1>
      </div>
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card title="Details">
          {editable ? (
            <form onSubmit={submit} className="grid grid-cols-2 gap-x-3 gap-y-2.5">
              <div className="col-span-2"><Field label="Production name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="National Convention · Exhibit Hall Stage" required maxLength={120} data-testid="live-f-name" /></Field></div>
              {id === null ? (
                <>
                  <Field label="Client organisation">
                    <Select value={org} onChange={(e) => setOrg(e.target.value)} data-testid="live-f-org">
                      <option value="">Not set yet</option>
                      {(clients.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      <option value={NEW}>New client…</option>
                    </Select>
                  </Field>
                  {org === NEW ? <Field label="Client's name"><Input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="As on the contract" maxLength={120} data-testid="live-f-neworg" /></Field> : <span />}
                </>
              ) : <div className="col-span-2"><Row label="Client">{p!.org?.name ?? "Not set"}</Row></div>}
              <Field label="First show day"><Input type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} /></Field>
              <Field label="Last show day"><Input type="date" value={f.endsOn} min={f.startsOn || undefined} onChange={(e) => setF({ ...f, endsOn: e.target.value })} /></Field>
              <Field label="Time zone"><Select value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>{ZONES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              {id !== null
                ? <Field label="Stage of work"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Status })}>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select></Field>
                : <span />}
              <div className="col-span-2"><Field label="Scope"><Input value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} placeholder="Stages, cameras, destinations, deliverables" maxLength={4000} /></Field></div>
              <div className="col-span-2 flex items-center gap-3 pt-1">
                <Btn primary type="submit" disabled={busy || !ready || (id !== null && !dirty)} data-testid="live-f-save">{busy ? "Saving…" : id === null ? "Create production" : "Save changes"}</Btn>
                <span className="text-[13px]" style={{ color: err || datesBad ? "#ff8a80" : C.muted }}>{datesBad ? "The last day is before the first." : err ?? (saved ? "Saved." : "")}</span>
              </div>
            </form>
          ) : (
            <>
              <Row label="Client">{p!.org?.name ?? "Not set"}</Row>
              <Row label="Dates">{fmtRange(p!.startsOn, p!.endsOn)}</Row>
              <Row label="Time zone">{zoneName(p!.timezone)}</Row>
              <Row label="Stage of work">{STATUS_LABEL[p!.status]}</Row>
              {p!.scope && <Row label="Scope">{p!.scope}</Row>}
            </>
          )}
          {id !== null && p!.org && (isAdmin || (p!.myRole && sideOf(p!.myRole) === "mv")) && <ClientBrand key={p!.org.id} org={p!.org} />}
        </Card>
        {id !== null && <Stages productionId={id} canAdd={!!p!.can.stages} />}
      </div>
    </div>
  );
}

function Stages({ productionId, canAdd }: { productionId: number; canAdd: boolean }) {
  const stages = useStages(productionId);
  const venues = useVenues(canAdd);
  const [name, setName] = useState("");
  const [venue, setVenue] = useState<string>("");
  const [nv, setNv] = useState({ name: "", address: "" });
  const addVenue = useAddVenue();
  const addStage = useAddStage(productionId);
  const busy = addVenue.isPending || addStage.isPending;
  const err = addVenue.error?.message ?? addStage.error?.message;
  const isNew = venue === NEW;
  const ready = name.trim() && (!isNew || nv.name.trim());
  const where = (s: Stage) => {
    if (!s.venue) return "No venue";
    const addr = venues.data?.find((v) => v.id === s.venue!.id)?.address;
    return addr ? `${s.venue.name}, ${addr}` : s.venue.name;
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    let venueId: number | null = venue && !isNew ? Number(venue) : null;
    if (isNew) {
      venueId = (await addVenue.mutateAsync({ name: nv.name.trim(), address: nv.address.trim() }).catch(() => null))?.id ?? null;
      if (!venueId) return;
    }
    addStage.mutate({ name: name.trim(), venueId }, { onSuccess: () => { setName(""); setVenue(""); setNv({ name: "", address: "" }); } });
  };

  return (
    <Card title="Stages and venues" testId="live-stages">
      {stages.data?.length
        ? stages.data.map((s) => <Row key={s.id} label={<span className="font-semibold" style={{ color: C.ink }}>{s.name}</span>}>{where(s)}</Row>)
        : <p className="text-[13.5px]" style={{ color: C.muted }}>{stages.isLoading ? "Loading…" : "No stage yet."}</p>}
      {canAdd && (
        <form onSubmit={add} className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 border-t pt-3" style={{ borderColor: C.line }}>
          <Field label="Stage name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Exhibit Hall Stage" maxLength={80} data-testid="live-stage-name" /></Field>
          <Field label="Venue">
            <Select value={venue} onChange={(e) => setVenue(e.target.value)} data-testid="live-stage-venue">
              <option value="">Pick a venue</option>
              {(venues.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              <option value={NEW}>New venue…</option>
            </Select>
          </Field>
          {isNew && (
            <>
              <Field label="Venue name"><Input value={nv.name} onChange={(e) => setNv({ ...nv, name: e.target.value })} placeholder="Convention center" maxLength={120} /></Field>
              <Field label="Address"><Input value={nv.address} onChange={(e) => setNv({ ...nv, address: e.target.value })} placeholder="Street, city, state" maxLength={200} /></Field>
            </>
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

/**
 * The client's logo and portal colour, in one row under Details (MV roles only). Both live on the client org, so the
 * portal at /live/<client> shows them for every production with that client. Logo is a link for now (https://).
 */
function ClientBrand({ org }: { org: LiveOrg }) {
  const [logo, setLogo] = useState(org.logoUrl);
  const [color, setColor] = useState(org.brandColor);
  const [broken, setBroken] = useState(false);
  const [saved, setSaved] = useState(false);
  const save = usePatchOrg(org.id);
  const tile = brand(color);
  const logoOk = !logo.trim() || /^https:\/\/\S+$/.test(logo.trim());
  const dirty = logo.trim() !== org.logoUrl || color !== org.brandColor;
  useEffect(() => setBroken(false), [logo]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty || !logoOk) return;
    save.mutate({ logoUrl: logo.trim(), brandColor: color }, { onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2500); } });
  };

  return (
    <form onSubmit={submit} className="mt-3 border-t pt-3" style={{ borderColor: C.line }} data-testid="live-client-brand">
      <p className="mb-1.5 text-[12px] font-semibold uppercase" style={{ fontFamily: FONT_COND, letterSpacing: ".08em", color: C.muted }}>Client's logo and colour</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md text-[13px] font-bold" style={{ background: logo.trim() && logoOk && !broken ? "#fff" : tile.bg, color: tile.fg }} aria-hidden>
          {logo.trim() && logoOk && !broken
            ? <img src={logo.trim()} alt="" className="h-full w-full object-contain" onError={() => setBroken(true)} />
            : initials(org.name)}
        </span>
        <Input value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="Logo link, https://…" maxLength={500} className="min-w-0 flex-1 basis-[180px]" aria-label="Logo link" data-testid="live-brand-logo" />
        <label className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-[13px]" style={{ borderColor: C.line }} title="Portal colour">
          <input type="color" value={tile.bg} onChange={(e) => setColor(e.target.value)} className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0" aria-label="Portal colour" data-testid="live-brand-color" />
          <span className="font-mono text-[12px]" style={{ color: color ? C.ink : C.muted }}>{color ? color.toUpperCase() : "Navy"}</span>
        </label>
        {color && <button type="button" className="h-9 shrink-0 px-1 text-[13px] hover:underline" style={{ color: C.muted }} onClick={() => setColor("")}>Use navy</button>}
        <Btn type="submit" small disabled={!dirty || !logoOk || save.isPending} data-testid="live-brand-save">{save.isPending ? "Saving…" : "Save"}</Btn>
      </div>
      <p className="mt-1.5 text-[12.5px]" style={{ color: !logoOk || broken || save.error ? "#ff8a80" : C.muted }}>
        {!logoOk ? "Logo links start with https://." : broken ? "That link doesn't open as an image." : save.error?.message ?? (saved ? "Saved. The client's portal shows it now." : `Shows on ${org.name}'s portal, for every production with them.`)}
      </p>
    </form>
  );
}
