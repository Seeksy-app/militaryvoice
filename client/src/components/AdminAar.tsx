import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adminGet, adminSend } from "@/lib/adminApi";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Check, X, Pencil, Save, CircleCheck, CircleAlert, CircleDot, Circle } from "lucide-react";
import type { AarReport, AarSection, AarAction } from "@shared/aar";

// Admin → AAR: after-action reports, one per author, side by side by a switch.
// Used twice: inside an event (how the event went) and at the platform level
// (what the owner learns about running many events at once). Each author keeps
// their own copy so the reports are written apart and compared after — that is
// how an AAR stays honest.

type Report = AarReport & { actions?: AarAction[] };
const AUTHORS = [
  { key: "claude", label: "Claude", sub: "SI producer" },
  { key: "michael", label: "Michael", sub: "AI Stage Manager" },
] as const;

// What kind of point each section holds, so the eye can scan for it.
const MARK: Record<string, { icon: typeof Circle; tone: string }> = {
  right: { icon: CircleCheck, tone: "text-emerald-600" },
  sustain: { icon: CircleCheck, tone: "text-emerald-600" },
  wrong: { icon: CircleAlert, tone: "text-red-600" },
  better: { icon: CircleDot, tone: "text-[#b07800]" },
  improve: { icon: CircleDot, tone: "text-[#b07800]" },
};

function mark(sectionId: string, line: string) {
  // A seat's view mixes kinds; its lines say which with "Right:", "Wrong:", "Better:".
  const lead = /^(right|wrong|better):\s*/i.exec(line);
  const kind = lead ? lead[1].toLowerCase() : sectionId;
  return { ...(MARK[kind] ?? { icon: Circle, tone: "text-slate-400" }), text: lead ? line.slice(lead[0].length) : line, kind: lead ? lead[1] : "" };
}

function Section({ s }: { s: AarSection }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5" data-testid={`aar-section-${s.id}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold text-foreground">{s.heading}</h3>
        {s.perspective && <span className="rounded-full bg-[#000741]/5 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-[#000741] dark:bg-white/10 dark:text-white">{s.perspective}</span>}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{s.prompt}</p>
      {s.items.length === 0 ? (
        <p className="mt-3 text-sm italic text-muted-foreground">Not written yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {s.items.map((line, i) => {
            const m = mark(s.id, line);
            const Icon = m.icon;
            return (
              <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-foreground">
                <Icon className={`mt-[3px] h-4 w-4 shrink-0 ${m.tone}`} />
                <span>
                  {m.kind && <span className={`font-semibold ${m.tone}`}>{m.kind}. </span>}
                  {m.text}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function AdminAar({ scope, title, intro, single = false }: { scope: string; title: string; intro: string; single?: boolean }) {
  const [author, setAuthor] = useState<(typeof AUTHORS)[number]["key"]>("claude");
  const qc = useQueryClient();
  const key = ["/api/admin/aar", scope, author];
  const { data, isLoading } = useQuery<{ report: Report; saved: boolean }>({
    queryKey: key,
    queryFn: () => adminGet(`/api/admin/aar?scope=${encodeURIComponent(scope)}&author=${author}`),
  });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ summary: string; sections: Record<string, string>; actions: string }>({ summary: "", sections: {}, actions: "" });
  const [saving, setSaving] = useState(false);
  useEffect(() => setEditing(false), [author, scope]);

  const report = data?.report;
  const startEdit = () => {
    if (!report) return;
    setDraft({
      summary: report.summary,
      sections: Object.fromEntries(report.sections.map((s) => [s.id, s.items.join("\n")])),
      actions: (report.actions ?? []).map((a) => [a.what, a.owner, a.when].join(" | ")).join("\n"),
    });
    setEditing(true);
  };
  const save = async () => {
    if (!report) return;
    setSaving(true);
    const lines = (t: string) => t.split("\n").map((l) => l.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);
    const next: Report = {
      ...report,
      written: new Date().toISOString().slice(0, 10),
      summary: draft.summary.trim(),
      sections: report.sections.map((s) => ({ ...s, items: lines(draft.sections[s.id] ?? "") })),
      ...(report.actions
        ? { actions: lines(draft.actions).map((l) => { const [what, owner = "", when = ""] = l.split("|").map((x) => x.trim()); return { what, owner, when }; }) }
        : {}),
    };
    await adminSend("PUT", "/api/admin/aar", { scope, author, report: next });
    await qc.invalidateQueries({ queryKey: key });
    setSaving(false);
    setEditing(false);
  };

  // Each seat's view sits side by side; everything else runs full width.
  const blocks: (AarSection | AarSection[])[] = [];
  for (const s of report?.sections ?? []) {
    const last = blocks[blocks.length - 1];
    if (s.perspective && Array.isArray(last)) last.push(s);
    else blocks.push(s.perspective ? [s] : s);
  }

  return (
    <div className="max-w-5xl space-y-5" data-testid={`aar-${scope}`}>
      <div className="rounded-2xl border border-border bg-card p-5">
        <p className="text-xs font-bold uppercase tracking-wider text-[#8a5a00]">After-action report</p>
        <h2 className="mt-1 text-2xl font-bold text-[#000741] dark:text-white">{title}</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{intro}</p>
        <p className="mt-2 max-w-3xl text-xs text-muted-foreground">
          Four questions: what was supposed to happen, what actually happened, why, and what we do better. No blame — problems belong to the plan and the system, not to a person. {single ? "" : "Each author writes their own, apart, then the two are compared."}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!single && <div className="inline-flex rounded-xl border border-border bg-muted/50 p-1" role="tablist">
            {AUTHORS.map((a) => (
              <button
                key={a.key}
                role="tab"
                aria-selected={author === a.key}
                onClick={() => setAuthor(a.key)}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${author === a.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                data-testid={`aar-author-${a.key}`}
              >
                {a.label} <span className="font-normal text-muted-foreground">· {a.sub}</span>
              </button>
            ))}
          </div>}
          {!editing ? (
            <Button size="sm" variant="outline" className="ml-auto gap-1.5" onClick={startEdit} disabled={!report} data-testid="aar-edit">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          ) : (
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setEditing(false)}><X className="h-3.5 w-3.5" /> Cancel</Button>
              <Button size="sm" className="gap-1.5" onClick={save} disabled={saving} data-testid="aar-save"><Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save"}</Button>
            </div>
          )}
        </div>
      </div>

      {isLoading || !report ? (
        <p className="p-4 text-sm text-muted-foreground">Loading…</p>
      ) : editing ? (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">One point per line. A seat's line can start with "Right:", "Wrong:" or "Better:".</p>
          <label className="block rounded-2xl border border-border bg-card p-5">
            <span className="text-base font-semibold">Bottom line</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">Two or three sentences someone could read alone.</span>
            <Textarea className="mt-2" rows={4} value={draft.summary} onChange={(e) => setDraft((d) => ({ ...d, summary: e.target.value }))} />
          </label>
          {report.sections.map((s) => (
            <label key={s.id} className="block rounded-2xl border border-border bg-card p-5">
              <span className="text-base font-semibold">{s.heading}{s.perspective ? ` · ${s.perspective}` : ""}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{s.prompt}</span>
              <Textarea
                className="mt-2 font-[inherit]"
                rows={Math.max(4, (draft.sections[s.id] ?? "").split("\n").length + 1)}
                value={draft.sections[s.id] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, sections: { ...d.sections, [s.id]: e.target.value } }))}
              />
            </label>
          ))}
          {report.actions && (
            <label className="block rounded-2xl border border-border bg-card p-5">
              <span className="text-base font-semibold">Actions</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">One per line: what | who | when</span>
              <Textarea className="mt-2" rows={Math.max(4, draft.actions.split("\n").length + 1)} value={draft.actions} onChange={(e) => setDraft((d) => ({ ...d, actions: e.target.value }))} />
            </label>
          )}
        </div>
      ) : (
        <>
          <div className="rounded-2xl border-l-4 border-[#F0A71F] bg-[#F0A71F]/10 p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-[#8a5a00]">Bottom line</p>
            <p className="mt-1.5 text-[15px] leading-relaxed text-foreground">{report.summary || <span className="italic text-muted-foreground">Not written yet.</span>}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {report.author} · {report.role}
              {report.written ? ` · ${new Date(report.written + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}
            </p>
          </div>
          {blocks.map((b, i) =>
            Array.isArray(b) ? (
              <div key={i}>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Through each seat</p>
                <div className="grid gap-4 md:grid-cols-2">{b.map((s) => <Section key={s.id} s={s} />)}</div>
              </div>
            ) : (
              <Section key={b.id} s={b} />
            ),
          )}
          {report.actions && report.actions.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-border bg-card" data-testid="aar-actions">
              <div className="p-5 pb-3">
                <h3 className="text-base font-semibold">Actions</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Each improvement with an owner and a date, in the order they unblock scale.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr><th className="px-5 py-2 font-semibold">What</th><th className="px-3 py-2 font-semibold">Who</th><th className="px-5 py-2 font-semibold">When</th></tr>
                  </thead>
                  <tbody>
                    {report.actions.map((a, i) => (
                      <tr key={i} className="border-t border-border align-top">
                        <td className="px-5 py-2.5"><span className="flex gap-2"><Check className="mt-[3px] h-3.5 w-3.5 shrink-0 text-muted-foreground" />{a.what}</span></td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{a.owner}</td>
                        <td className="whitespace-nowrap px-5 py-2.5 text-muted-foreground">{a.when}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
