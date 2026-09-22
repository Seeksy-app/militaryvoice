import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Send, Loader2, Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { adminSend } from "@/lib/adminApi";

type Turn = { role: "user" | "assistant"; content: string };
type Draft = { to: string; toName: string; subject: string; text: string; from: "alex" | "team" | "riccoh" | "michael" };
type Msg = Turn & { draft?: Draft | null; sent?: boolean };

const FROM_LABEL: Record<Draft["from"], string> = { alex: "Alex", team: "the team", riccoh: "Riccoh", michael: "Michael" };

/**
 * Talk to Alex; she drafts; you send.
 *
 * "Send Frank an email saying thanks for your patience" becomes a draft card
 * under her reply, with the recipient she found, editable, and one Send
 * button. Nothing goes out until that button. She answers questions about
 * the day too, from the same facts the help desk uses.
 */
export function AdminChat({ eventId }: { eventId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", content: "Hi — tell me who to write to and what to say, and I'll draft it for you to send. Or ask me anything about the day." },
  ]);
  const [input, setInput] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [edit, setEdit] = useState<Draft | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length]);

  const ask = useMutation({
    mutationFn: async (text: string) => {
      const history: Turn[] = [...msgs.map(({ role, content }) => ({ role, content })), { role: "user", content: text }];
      const r = await adminSend("POST", "/api/admin/chat", { eventId, messages: history });
      return (await r.json()) as { reply: string; draft: Draft | null };
    },
    onMutate: (text) => {
      setMsgs((m) => [...m, { role: "user", content: text }]);
      setInput("");
    },
    onSuccess: (r) => setMsgs((m) => [...m, { role: "assistant", content: r.reply, draft: r.draft }]),
    onError: (err: Error) => {
      setMsgs((m) => [...m, { role: "assistant", content: `That didn't go through: ${err.message}` }]);
    },
  });

  const send = useMutation({
    mutationFn: async ({ index, draft }: { index: number; draft: Draft }) => {
      const r = await adminSend("POST", "/api/admin/chat/send", draft);
      return { index, body: (await r.json()) as { ok: boolean; id: string } };
    },
    onSuccess: ({ index }) => {
      setMsgs((m) => m.map((x, i) => (i === index ? { ...x, sent: true } : x)));
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/broadcasts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/inbound"] });
      toast({ title: "Sent", description: "Filed in the activity log." });
    },
    onError: (err: Error) => toast({ title: "Couldn't send", description: err.message, variant: "destructive" }),
  });

  function submit() {
    const text = input.trim();
    if (!text || ask.isPending) return;
    ask.mutate(text);
  }

  return (
    <div className="flex h-[min(70vh,720px)] flex-col overflow-hidden rounded-2xl border border-border bg-card" data-testid="admin-chat">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <img src="/alex.jpg" alt="" className="h-9 w-9 rounded-full object-cover" />
        <div>
          <p className="text-sm font-semibold">Alex</p>
          <p className="text-[11px] text-muted-foreground">Drafts what you say; you press Send.</p>
        </div>
      </div>

      <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {msgs.map((m, i) => (
          <div key={i} className={`flex items-end gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "assistant" && <img src="/alex.jpg" alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />}
            <div className={`max-w-[85%] ${m.role === "user" ? "" : "min-w-0 flex-1"}`}>
              <div className={`inline-block whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${m.role === "user" ? "bg-[#053877] text-white" : "bg-muted text-foreground"}`}>
                {m.content}
              </div>
              {m.draft && (
                <div className="mt-2 rounded-xl border border-border bg-background p-3 text-sm shadow-sm" data-testid={`chat-draft-${i}`}>
                  {editing === i && edit ? (
                    <div className="flex flex-col gap-2">
                      <Input value={edit.to} onChange={(e) => setEdit({ ...edit, to: e.target.value })} className="h-8 text-sm" placeholder="To" />
                      <Input value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} className="h-8 text-sm" placeholder="Subject" />
                      <Textarea value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} rows={8} className="text-sm" />
                      <div className="flex items-center gap-2">
                        <select value={edit.from} onChange={(e) => setEdit({ ...edit, from: e.target.value as Draft["from"] })} className="h-8 rounded-md border border-border bg-background px-2 text-xs">
                          {(["alex", "riccoh", "michael", "team"] as const).map((f) => <option key={f} value={f}>From {FROM_LABEL[f]}</option>)}
                        </select>
                        <Button size="sm" className="h-8 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" disabled={send.isPending} onClick={() => send.mutate({ index: i, draft: edit })}>
                          <Send className="mr-1.5 h-3.5 w-3.5" /> Send
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditing(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {m.sent ? "Sent" : "Draft"} · to {m.draft.toName || m.draft.to} &lt;{m.draft.to}&gt; · from {FROM_LABEL[m.draft.from]}
                      </p>
                      <p className="mt-1 font-semibold">{m.draft.subject}</p>
                      <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-foreground/90">{m.draft.text}</pre>
                      <div className="mt-3 flex items-center gap-2">
                        {m.sent ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"><Check className="h-3.5 w-3.5" /> Sent and filed in the activity log</span>
                        ) : (
                          <>
                            <Button size="sm" className="h-8 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" disabled={send.isPending} onClick={() => send.mutate({ index: i, draft: m.draft! })} data-testid={`chat-send-${i}`}>
                              {send.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />} Send as {FROM_LABEL[m.draft.from]}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-8" onClick={() => { setEditing(i); setEdit(m.draft!); }}>
                              <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                            </Button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {ask.isPending && (
          <div className="flex items-end gap-2">
            <img src="/alex.jpg" alt="" className="h-6 w-6 rounded-full object-cover" />
            <div className="rounded-2xl bg-muted px-3.5 py-2.5 text-sm text-muted-foreground"><Loader2 className="inline h-3.5 w-3.5 animate-spin" /> thinking…</div>
          </div>
        )}
      </div>

      <form
        className="flex items-end gap-2 border-t border-border p-3"
        onSubmit={(e) => { e.preventDefault(); submit(); }}
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          rows={1}
          placeholder='Send Frank an email saying "Thanks for your patience…"'
          className="min-h-[40px] resize-none text-sm"
          data-testid="admin-chat-input"
        />
        <Button type="submit" size="icon" className="h-10 w-10 shrink-0 rounded-full bg-[#053877] text-white hover:bg-[#0a4a99]" disabled={!input.trim() || ask.isPending} aria-label="Send">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
