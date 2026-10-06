import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, Eye } from "lucide-react";
import { SURVEY_QUESTIONS } from "@shared/survey";

// Admin → Survey: the after-show survey at a glance. How many answered, the
// totals for each question as bars, the words people wrote, and everyone
// invited with whether they've opened it or answered.

type Person = { id: number; name: string; email: string; role: string; openedAt: string; completedAt: string; answers: Record<string, string | string[]> };
type Data = { people: Person[]; totals: Record<string, Record<string, number>>; notes: { name: string; text: string }[]; invited: number; answered: number };

const ROLE: Record<string, string> = { host: "Host", cohost: "Co-host", interviewee: "Guest" };
const when = (iso: string) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

export function AdminSurvey({ adminGet }: { adminGet: <T>(path: string) => Promise<T> }) {
  const { data, isLoading } = useQuery<Data>({ queryKey: ["/api/admin/survey"], queryFn: () => adminGet<Data>("/api/admin/survey"), refetchInterval: 60_000 });
  if (isLoading || !data) return <p className="p-4 text-sm text-slate-500">Loading the survey…</p>;
  if (!data.invited) return <p className="rounded-xl border bg-white p-6 text-sm text-slate-600">No one has been sent the survey yet. It goes out with Riccoh's thank-you emails.</p>;

  const pct = data.invited ? Math.round((data.answered / data.invited) * 100) : 0;
  return (
    <div className="max-w-4xl space-y-5" data-testid="admin-survey">
      <div className="rounded-2xl border bg-white p-5">
        <p className="text-xs font-bold uppercase tracking-wider text-[#8a5a00]">After-show survey · National Military Podcast Day 2026</p>
        <p className="mt-2 text-3xl font-bold text-[#000741]">{data.answered} of {data.invited} answered</p>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#F0A71F]" style={{ width: `${pct}%` }} /></div>
        <p className="mt-2 text-sm text-slate-500">{data.people.filter((p) => p.openedAt && !p.completedAt).length} opened it but haven't finished. {data.invited - data.people.filter((p) => p.openedAt).length} haven't opened it.</p>
      </div>

      {data.answered > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {SURVEY_QUESTIONS.filter((q) => q.kind !== "text").map((q) => {
            const t = data.totals[q.key] ?? {};
            const most = Math.max(1, ...Object.values(t));
            return (
              <div key={q.key} className="rounded-2xl border bg-white p-5">
                <p className="font-semibold text-[#000741]">{q.prompt}</p>
                <div className="mt-3 space-y-2">
                  {q.choices.map((c) => (
                    <div key={c.key}>
                      <div className="flex justify-between text-sm"><span className="text-slate-700">{c.emoji ? `${c.emoji} ` : ""}{c.label}</span><span className="font-semibold text-slate-900">{t[c.key] ?? 0}</span></div>
                      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#053877]" style={{ width: `${((t[c.key] ?? 0) / most) * 100}%` }} /></div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {data.notes.length > 0 && (
        <div className="rounded-2xl border bg-white p-5">
          <p className="font-semibold text-[#000741]">In their own words</p>
          <ul className="mt-3 space-y-3">
            {data.notes.map((n, i) => <li key={i} className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">“{n.text}” <span className="text-slate-500">— {n.name}</span></li>)}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border bg-white">
        <p className="border-b px-5 py-3 font-semibold text-[#000741]">Everyone invited</p>
        <ul className="divide-y">
          {data.people.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-5 py-3 text-sm">
              {p.completedAt ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : p.openedAt ? <Eye className="h-4 w-4 shrink-0 text-amber-500" /> : <Circle className="h-4 w-4 shrink-0 text-slate-300" />}
              <span className="min-w-0 flex-1"><span className="font-medium text-slate-900">{p.name || p.email}</span> <span className="text-slate-500">· {ROLE[p.role] ?? p.role}</span></span>
              <span className="shrink-0 text-xs text-slate-500">{p.completedAt ? `Answered ${when(p.completedAt)}` : p.openedAt ? `Opened ${when(p.openedAt)}` : "Not opened"}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
