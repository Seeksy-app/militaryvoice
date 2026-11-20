import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAdminAuth } from "@/lib/admin-auth";
import { adminGet, adminSend } from "@/lib/adminApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Pencil, Send, Trash2 } from "lucide-react";

// Alex's help desk (20 Nov): questions she wasn't sure of, waiting on the team. The visitor's chat shows
// the first answer within 5 minutes; after that they get the email form. Data: server/helpDesk.ts.

type Q = {
  id: number; question: string; turns: { role: string; content: string }[]; page: string; email: string;
  status: "open" | "answered" | "timed_out"; answer: string; answeredBy: string; answeredAt: string; createdAt: string; late: boolean;
};
type List = { questions: Q[]; waitSec: number; phoneSet: boolean };
type Learned = { id: string; q: string; a: string; at: string; by: string };

const ET = "America/New_York";
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: ET, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const left = (q: Q, waitSec: number, now: number) => {
  const s = Math.max(0, Math.ceil((Date.parse(q.createdAt) + waitSec * 1000 - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function OpenCard({ q, waitSec, now }: { q: Q; waitSec: number; now: number }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true); setErr("");
    try {
      await adminSend("POST", `/api/admin/help/questions/${q.id}/answer`, { answer: text.trim() });
      setText("");
      await qc.invalidateQueries({ queryKey: ["/api/admin/help/questions"] });
      await qc.invalidateQueries({ queryKey: ["/api/admin/help/learned"] });
    } catch (e) {
      setErr((e as Error).message.replace(/^\d+:\s*/, ""));
    } finally { setBusy(false); }
  };
  const earlier = q.turns.slice(0, -1);
  return (
    <li className="rounded-2xl border border-[#053877]/20 bg-white p-4 shadow-sm" data-testid={`helpdesk-open-${q.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>{when(q.createdAt)}{q.page ? ` · on ${q.page}` : ""}{q.email ? ` · ${q.email}` : ""}</span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">Waiting · {left(q, waitSec, now)} left</span>
      </div>
      <p className="mt-2 text-base font-semibold text-slate-900">{q.question}</p>
      {earlier.length > 0 && (
        <details className="mt-1 text-sm text-slate-600">
          <summary className="cursor-pointer text-xs text-slate-500">Earlier in the chat</summary>
          <div className="mt-2 space-y-1">{earlier.map((t, i) => <p key={i}><span className="font-semibold">{t.role === "user" ? "Visitor" : "Alex"}:</span> {t.content}</p>)}</div>
        </details>
      )}
      <form className="mt-3 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Your answer. It shows in their chat as “Here's what the team says: …”" className="text-sm" data-testid={`helpdesk-answer-${q.id}`}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }} />
        <Button type="submit" className="shrink-0 gap-1.5 rounded-full bg-[#053877]" disabled={busy || !text.trim()} data-testid={`helpdesk-send-${q.id}`}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Answer
        </Button>
      </form>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </li>
  );
}

function LearnedRow({ it }: { it: Learned }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [q, setQ] = useState(it.q);
  const [a, setA] = useState(it.a);
  const [err, setErr] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/admin/help/learned"] });
  const save = async () => {
    setErr("");
    try { await adminSend("PUT", `/api/admin/help/learned/${it.id}`, { q, a }); setEdit(false); await refresh(); }
    catch (e) { setErr((e as Error).message.replace(/^\d+:\s*/, "")); }
  };
  const remove = async () => {
    if (!window.confirm("Delete this answer? Alex won't know it any more.")) return;
    try { await adminSend("DELETE", `/api/admin/help/learned/${it.id}`); await refresh(); }
    catch (e) { setErr((e as Error).message.replace(/^\d+:\s*/, "")); }
  };
  if (edit) return (
    <li className="space-y-2 p-4">
      <Input value={q} onChange={(e) => setQ(e.target.value)} className="text-sm font-semibold" />
      <Textarea value={a} onChange={(e) => setA(e.target.value)} rows={3} className="text-sm" />
      <div className="flex gap-2">
        <Button size="sm" className="rounded-full bg-[#053877]" onClick={save} disabled={!q.trim() || !a.trim()}>Save</Button>
        <Button size="sm" variant="ghost" onClick={() => { setEdit(false); setQ(it.q); setA(it.a); }}>Cancel</Button>
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
    </li>
  );
  return (
    <li className="flex items-start gap-3 p-4" data-testid={`helpdesk-learned-${it.id}`}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">{it.q}</p>
        <p className="mt-1 text-sm text-slate-700">{it.a}</p>
        <p className="mt-1 text-xs text-slate-500">{when(it.at)}</p>
        {err && <p className="text-xs text-red-600">{err}</p>}
      </div>
      <button type="button" onClick={() => setEdit(true)} className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="Edit"><Pencil className="h-4 w-4" /></button>
      <button type="button" onClick={remove} className="rounded-full p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
    </li>
  );
}

function PhoneBox({ set }: { set: boolean }) {
  const qc = useQueryClient();
  const { data } = useQuery<{ phone: string }>({ queryKey: ["/api/admin/help/phone"], queryFn: () => adminGet("/api/admin/help/phone") });
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState("");
  const [err, setErr] = useState("");
  const save = async () => {
    setErr("");
    try {
      await adminSend("PUT", "/api/admin/help/phone", { phone: val });
      setEdit(false); setVal("");
      await qc.invalidateQueries({ queryKey: ["/api/admin/help/phone"] });
      await qc.invalidateQueries({ queryKey: ["/api/admin/help/questions"] });
    } catch (e) { setErr((e as Error).message.replace(/^\d+:\s*/, "")); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
      <span>Texts go to: <span className="font-semibold text-slate-900">{set ? data?.phone || "…" : "no phone yet"}</span>. Reply to the text to answer.</span>
      {edit ? (
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Input value={val} onChange={(e) => setVal(e.target.value)} placeholder="Mobile number" className="h-8 w-44" />
          <Button type="submit" size="sm" className="h-8 rounded-full">Save</Button>
          <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => setEdit(false)}>Cancel</Button>
        </form>
      ) : (
        <button type="button" className="font-medium text-[#053877] underline underline-offset-2" onClick={() => setEdit(true)}>Change</button>
      )}
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}

export default function HelpDesk() {
  const { isAuthenticated, isLoading } = useAdminAuth();
  const { data, error } = useQuery<List>({ queryKey: ["/api/admin/help/questions"], queryFn: () => adminGet<List>("/api/admin/help/questions"), enabled: isAuthenticated, refetchInterval: 5_000 });
  const { data: learned } = useQuery<{ items: Learned[] }>({ queryKey: ["/api/admin/help/learned"], queryFn: () => adminGet("/api/admin/help/learned"), enabled: isAuthenticated });
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { document.title = "Help desk · MilitaryVoices"; }, []);

  if (isLoading) return <div className="min-h-screen bg-slate-50 p-8">Loading…</div>;
  if (!isAuthenticated) return <div className="min-h-screen bg-slate-50 p-8"><p className="text-xl font-bold">Help desk</p><p className="mt-2 text-slate-600">Sign in to the admin first.</p><Link href="/admin" className="mt-4 inline-block rounded-full bg-[#053877] px-5 py-2 font-bold text-white">Open the admin</Link></div>;

  const qs = data?.questions ?? [];
  const open = qs.filter((q) => q.status === "open").sort((a, b) => a.id - b.id);
  const done = qs.filter((q) => q.status !== "open").slice(0, 30);
  const waitSec = data?.waitSec ?? 300;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-slate-900">Alex's help desk</h1>
          <Link href="/admin" className="text-sm font-medium text-[#053877] underline underline-offset-2">Back to admin</Link>
        </div>
        <p className="mt-1 text-sm text-slate-600 [text-wrap:pretty]">Questions Alex wasn't sure of. Your answer shows in the visitor's chat, and Alex learns it for next time. After 5 minutes they get the email form instead, and it lands in Mail → Needs a reply.</p>
        <div className="mt-3"><PhoneBox set={!!data?.phoneSet} /></div>
        {error && <p className="mt-4 text-sm text-red-600">{(error as Error).message}</p>}

        <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-slate-500">Waiting now ({open.length})</h2>
        {open.length === 0 ? (
          <p className="mt-2 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">Nothing waiting. New questions show here, in Slack and by text.</p>
        ) : (
          <ul className="mt-2 space-y-3">{open.map((q) => <OpenCard key={q.id} q={q} waitSec={waitSec} now={now} />)}</ul>
        )}

        <h2 className="mt-10 text-sm font-bold uppercase tracking-wide text-slate-500">What Alex has learned ({learned?.items.length ?? 0})</h2>
        <p className="mt-1 text-xs text-slate-500">She reads these on every chat. Edit or delete any that are wrong.</p>
        <ul className="mt-2 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
          {!learned?.items.length && <li className="p-4 text-sm text-slate-500">Nothing yet. Each answer you give lands here.</li>}
          {learned?.items.map((it) => <LearnedRow key={it.id} it={it} />)}
        </ul>

        <h2 className="mt-10 text-sm font-bold uppercase tracking-wide text-slate-500">Recent</h2>
        <ul className="mt-2 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
          {done.length === 0 && <li className="p-4 text-sm text-slate-500">None yet.</li>}
          {done.map((q) => (
            <li key={q.id} className="p-4" data-testid={`helpdesk-done-${q.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>{when(q.createdAt)}{q.email ? ` · ${q.email}` : ""}</span>
                {q.status === "answered" ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">Answered{q.answeredBy ? ` by ${q.answeredBy}` : ""}</span>
                ) : q.late ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">Answered late, not shown</span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">No answer in time</span>
                )}
              </div>
              <p className="mt-1 text-sm font-semibold text-slate-900">{q.question}</p>
              {q.answer && <p className="mt-1 text-sm text-slate-700">{q.answer}</p>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
