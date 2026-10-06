import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronLeft, Loader2 } from "lucide-react";
import { SURVEY_QUESTIONS } from "@shared/survey";

// The after-show survey, from the link in Riccoh's thank-you. One question a
// screen and a tap to answer, because most people open it on a phone between
// other things: a single choice moves on by itself, a pick-several has Next,
// and the last question is optional words. No sign-in; the link is theirs.

const HEAD = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;
type Answers = Record<string, string | string[]>;

export default function Survey({ token }: { token: string }) {
  const { data, isLoading, error } = useQuery<{ name: string; done: boolean }>({
    queryKey: ["/api/survey", token],
    queryFn: async () => {
      const r = await fetch(`/api/survey/${encodeURIComponent(token)}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "That survey link isn't right.");
      return r.json();
    },
    retry: false,
  });
  const [step, setStep] = useState(-1);
  const [answers, setAnswers] = useState<Answers>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");

  const q = step >= 0 ? SURVEY_QUESTIONS[step] : null;
  const last = step === SURVEY_QUESTIONS.length - 1;

  const submit = async (final: Answers) => {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`/api/survey/${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers: final }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "That didn't send. Please try again.");
      setSent(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const next = (a: Answers) => (last ? void submit(a) : setStep((s) => s + 1));
  const pickOne = (key: string) => {
    const a = { ...answers, [q!.key]: key };
    setAnswers(a);
    // A beat to see the tap land, then on.
    setTimeout(() => next(a), 180);
  };
  const toggle = (key: string) => {
    const have = (answers[q!.key] as string[] | undefined) ?? [];
    const on = have.includes(key);
    if (!on && q!.max && have.length >= q!.max) return;
    setAnswers({ ...answers, [q!.key]: on ? have.filter((k) => k !== key) : [...have, key] });
  };

  const shell = (children: React.ReactNode) => (
    <main className="flex min-h-screen items-start justify-center px-4 py-8 sm:items-center" style={{ background: "linear-gradient(180deg, #000741, #053877)" }}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl sm:p-8">{children}</div>
    </main>
  );

  if (isLoading) return shell(<div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>);
  if (error || !data) return shell(<p className="py-6 text-center text-slate-600">{(error as Error)?.message ?? "That survey link isn't right."}</p>);

  if (sent || data.done) {
    return shell(
      <div className="py-4 text-center" data-testid="survey-done">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
        <h1 className="mt-3 text-2xl font-bold text-[#000741]" style={HEAD}>Thank you, {data.name}</h1>
        <p className="mt-2 text-pretty text-slate-600">{sent ? "Got it. Your answers go straight to the team, and they shape what we build next." : "You've already answered. Thank you!"}</p>
        <a href="/host/dashboard" className="mt-6 inline-block rounded-full bg-[#F0A71F] px-6 py-3 font-bold text-[#000741]">Go to my dashboard</a>
      </div>,
    );
  }

  if (!q) {
    return shell(
      <div className="text-center">
        <img src="/nmpd-logo.png" alt="National Military Podcast Day" className="mx-auto h-20 w-20" />
        <h1 className="mt-4 text-balance text-2xl font-bold text-[#000741]" style={HEAD}>Hi {data.name}, how did it go?</h1>
        <p className="mt-2 text-pretty text-slate-600">Seven quick questions about National Military Podcast Day. One minute, mostly taps.</p>
        <button type="button" onClick={() => setStep(0)} className="mt-6 h-12 w-full rounded-xl bg-[#F0A71F] text-base font-bold text-[#000741] hover:bg-[#e09a10]" data-testid="survey-start">Start</button>
      </div>,
    );
  }

  const picked = answers[q.key];
  return shell(
    <div data-testid={`survey-q-${q.key}`}>
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setStep((s) => s - 1)} className="-ml-2 flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-slate-500 hover:text-slate-800" aria-label="Back"><ChevronLeft className="h-4 w-4" /> Back</button>
        <span className="text-xs font-semibold text-slate-400">{step + 1} of {SURVEY_QUESTIONS.length}</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#F0A71F] transition-all" style={{ width: `${((step + 1) / SURVEY_QUESTIONS.length) * 100}%` }} /></div>
      <h1 className="mt-5 text-balance text-xl font-bold text-[#000741] sm:text-2xl" style={HEAD}>{q.prompt}</h1>
      {q.hint && <p className="mt-1 text-sm text-slate-500">{q.hint}</p>}

      {q.kind === "one" && (
        <div className={`mt-5 ${q.choices.some((c) => c.emoji) ? "grid grid-cols-5 gap-2" : "space-y-2.5"}`}>
          {q.choices.map((c) => c.emoji ? (
            <button key={c.key} type="button" onClick={() => pickOne(c.key)} className={`flex flex-col items-center gap-1 rounded-xl border-2 px-1 py-3 transition ${picked === c.key ? "border-[#F0A71F] bg-amber-50" : "border-slate-200 hover:border-slate-300"}`} data-testid={`survey-${q.key}-${c.key}`}>
              <span className="text-3xl leading-none">{c.emoji}</span>
              <span className="text-[11px] font-medium leading-tight text-slate-600">{c.label}</span>
            </button>
          ) : (
            <button key={c.key} type="button" onClick={() => pickOne(c.key)} className={`w-full rounded-xl border-2 px-4 py-3.5 text-left text-base font-semibold transition ${picked === c.key ? "border-[#F0A71F] bg-amber-50 text-[#000741]" : "border-slate-200 text-slate-700 hover:border-slate-300"}`} data-testid={`survey-${q.key}-${c.key}`}>{c.label}</button>
          ))}
        </div>
      )}

      {q.kind === "many" && (
        <>
          <div className="mt-5 space-y-2.5">
            {q.choices.map((c) => {
              const on = Array.isArray(picked) && picked.includes(c.key);
              return (
                <button key={c.key} type="button" onClick={() => toggle(c.key)} aria-pressed={on} className={`flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3.5 text-left text-base font-semibold transition ${on ? "border-[#F0A71F] bg-amber-50 text-[#000741]" : "border-slate-200 text-slate-700 hover:border-slate-300"}`} data-testid={`survey-${q.key}-${c.key}`}>
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 ${on ? "border-[#F0A71F] bg-[#F0A71F] text-white" : "border-slate-300"}`}>{on ? "✓" : ""}</span>
                  {c.label}
                </button>
              );
            })}
          </div>
          <button type="button" onClick={() => next(answers)} disabled={!Array.isArray(picked) || !picked.length} className="mt-5 h-12 w-full rounded-xl bg-[#F0A71F] text-base font-bold text-[#000741] hover:bg-[#e09a10] disabled:opacity-40" data-testid="survey-next">Next</button>
        </>
      )}

      {q.kind === "text" && (
        <>
          <textarea value={(picked as string) ?? ""} onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })} rows={4} maxLength={2000} placeholder="Type here, or skip" className="mt-5 w-full rounded-xl border-2 border-slate-200 p-3 text-base focus:border-[#000741] focus:outline-none" data-testid="survey-text" />
          {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
          <button type="button" onClick={() => void submit(answers)} disabled={busy} className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-[#F0A71F] text-base font-bold text-[#000741] hover:bg-[#e09a10]" data-testid="survey-send">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Send my answers"}
          </button>
        </>
      )}
    </div>,
  );
}
