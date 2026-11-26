import { useState } from "react";
import { X } from "lucide-react";
import { useLive } from "./LiveApp";
import { can, ROLE_LABEL, sideOf, useLiveWrite, useMembers, type Member, type Role, type Side } from "./api";
import { Btn, C, Card, Coming, Field, FONT_COND, Input, Pill, Select } from "./ui";

/**
 * Crew & Technical, phase 1: the people on a production and their roles. Invites are stored only: nothing is emailed
 * until Andrew approves the invite text and invites are switched on. Kit and Signal come with phase 3.
 */
const GROUPS: { side: Side; title: string }[] = [
  { side: "mv", title: "MilitaryVoices.ai" },
  { side: "crew", title: "Crew" },
  { side: "client", title: "Client" },
];

export default function Crew() {
  const { current, role, side } = useLive();
  const [tab, setTab] = useState<"crew" | "kit" | "signal">("crew");
  const members = useMembers(current?.id ?? null);
  if (!current) return <p style={{ color: C.muted }}>Pick or create a production first.</p>;
  const rows = (members.data ?? []).filter((m) => m.status !== "removed");
  const assignable = can.assignable(role);
  // Crew see only their own vendor's people; MV see everyone, grouped.
  const groups = side === "mv" ? GROUPS : GROUPS.filter((g) => g.side === side);

  return (
    <div className="flex flex-col gap-3" data-testid="live-crew">
      <div className="flex items-center gap-4">
        <h1 className="text-[24px] font-semibold leading-none" style={{ fontFamily: FONT_COND }}>Crew &amp; Technical</h1>
        <div className="flex gap-1" role="tablist">
          {(["crew", "kit", "signal"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className="h-8 rounded-md px-3 text-[13.5px] font-semibold hover:bg-white/5"
              style={tab === t ? { background: C.active, color: "#fff" } : { color: C.muted }}
            >
              {t === "crew" ? "People" : t === "kit" ? "Kit" : "Signal"}
            </button>
          ))}
        </div>
      </div>

      {tab === "kit" && <Card><Coming what="Equipment list with owner, serial and spares, made from the single-stage template" phase={3} /></Card>}
      {tab === "signal" && <Card><Coming what="Feed keys, connectivity tests, destinations with backups, escalation phone tree" phase={3} /></Card>}

      {tab === "crew" && (
        <>
          {assignable.length > 0 && <Invite productionId={current.id} roles={assignable} vendorOrgs={vendorOrgs(rows)} asMv={side === "mv"} />}
          <Card testId="live-people">
            {groups.map((g, i) => {
              const list = rows.filter((m) => sideOf(m.role) === g.side);
              return (
                <div key={g.side} className={i ? "mt-3" : ""} data-testid={`live-group-${g.side}`}>
                  <p className="mb-0.5 text-[13px] font-semibold uppercase" style={{ fontFamily: FONT_COND, letterSpacing: ".08em", color: C.muted }}>{g.title} · {list.length}</p>
                  {list.length ? list.map((m) => <MemberRow key={m.id} m={m} roles={assignable} productionId={current.id} />) : <p className="py-1 text-[13.5px]" style={{ color: C.muted }}>No one yet.</p>}
                </div>
              );
            })}
            {side === "mv" && <div className="mt-3"><Coming what="Call times, rates, contracts and confirmed, per crew member" phase={3} /></div>}
          </Card>
        </>
      )}
    </div>
  );
}

const vendorOrgs = (rows: Member[]) => Array.from(new Set(rows.filter((m) => sideOf(m.role) === "crew" && m.org_name).map((m) => m.org_name)));

function Invite({ productionId, roles, vendorOrgs, asMv }: { productionId: number; roles: Role[]; vendorOrgs: string[]; asMv: boolean }) {
  const [f, setF] = useState({ email: "", name: "", role: roles[0], org_name: "" });
  const [done, setDone] = useState("");
  const save = useLiveWrite<typeof f, Member>("POST", () => `/productions/${productionId}/members`);
  const s = sideOf(f.role);
  // The vendor (crew) or client organisation they belong to; MV staff have none.
  const needsOrg = asMv && s !== "mv";
  const ok = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim()) && (!needsOrg || f.org_name.trim());
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    save.mutate(needsOrg ? f : { ...f, org_name: "" }, {
      onSuccess: (m) => { setDone(`Invite saved for ${m.email}. We'll send it when invites are switched on.`); setF({ ...f, email: "", name: "" }); },
    });
  };
  return (
    <Card title="Add someone" testId="live-invite">
      <form onSubmit={submit} className="grid grid-cols-1 items-end gap-2.5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,.9fr)_minmax(0,1.1fr)_auto]">
        <Field label="Email"><Input type="email" value={f.email} onChange={(e) => { setF({ ...f, email: e.target.value }); setDone(""); }} placeholder="name@company.com" data-testid="live-invite-email" /></Field>
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Optional" maxLength={80} /></Field>
        <Field label="Role">
          <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })} data-testid="live-invite-role">
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
        </Field>
        {needsOrg ? (
          <Field label={s === "crew" ? "Vendor" : "Client organisation"}>
            <Input value={f.org_name} onChange={(e) => setF({ ...f, org_name: e.target.value })} list={s === "crew" ? "live-vendors" : undefined} placeholder={s === "crew" ? "AV company" : "Client's organisation"} maxLength={120} data-testid="live-invite-org" />
            <datalist id="live-vendors">{vendorOrgs.map((o) => <option key={o} value={o} />)}</datalist>
          </Field>
        ) : <span className="hidden lg:block" />}
        <Btn primary type="submit" disabled={!ok || save.isPending} data-testid="live-invite-save">{save.isPending ? "Saving…" : "Save invite"}</Btn>
      </form>
      <p className="mt-2 text-[13px]" style={{ color: save.error ? "#ff8a80" : done ? "#7fe0a6" : C.muted }} role="status">
        {save.error?.message ?? (done || "Invites are saved, not emailed. We'll send them when invites are switched on.")}
      </p>
    </Card>
  );
}

function MemberRow({ m, roles, productionId }: { m: Member; roles: Role[]; productionId: number }) {
  const patch = useLiveWrite<{ role?: Role; status?: "removed" }, Member>("PATCH", () => `/productions/${productionId}/members/${m.id}`);
  const canChange = roles.includes(m.role);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-1.5 text-[13.5px] last:border-b-0" style={{ borderColor: C.line }} data-testid={`live-member-${m.id}`}>
      <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
        <p className="truncate font-semibold">{m.name || m.email}</p>
        <p className="truncate text-[12.5px]" style={{ color: C.muted }}>{m.name ? m.email : ""}{m.name && sideOf(m.role) !== "mv" && m.org_name ? " · " : ""}{sideOf(m.role) !== "mv" ? m.org_name : ""}</p>
      </div>
      {m.status === "invited" ? <Pill tone="warn">Invite saved</Pill> : <Pill tone="ok">Active</Pill>}
      {canChange ? (
        <select
          value={m.role}
          onChange={(e) => patch.mutate({ role: e.target.value as Role })}
          className="h-8 w-[150px] rounded-md border bg-transparent px-2 text-[13px] outline-none"
          style={{ borderColor: C.line, color: C.ink, colorScheme: "dark" }}
          aria-label={`Role for ${m.email}`}
        >
          {roles.filter((r) => sideOf(r) === sideOf(m.role)).map((r) => <option key={r} value={r} style={{ background: C.bg }}>{ROLE_LABEL[r]}</option>)}
        </select>
      ) : (
        <span className="w-[150px] text-[13px]" style={{ color: C.muted }}>{ROLE_LABEL[m.role]}</span>
      )}
      {canChange ? (
        <button
          type="button"
          onClick={() => { if (window.confirm(`Take ${m.email} off this production?`)) patch.mutate({ status: "removed" }); }}
          className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/10"
          style={{ color: C.muted }}
          aria-label={`Remove ${m.email}`}
          title="Remove"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      ) : <span className="w-8" />}
      {patch.error && <span className="text-[12px] text-[#ff8a80]">{patch.error.message}</span>}
    </div>
  );
}
