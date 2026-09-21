import { Download, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Contact { id: number; name: string; email: string; phone: string; createdAt: string; signupId: number }

/**
 * The people who asked to be told when this show is on.
 *
 * They used to sit at the bottom of the promotion page, under the work, as
 * a table nobody scrolled to. A contact is a result, not a task: it gets its
 * own tab, which appears the moment there is one to show.
 */
export function ContactsScreen({ contacts }: { contacts: Contact[] }) {
  const rows = [...contacts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  function download() {
    const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = ["name,email,phone,asked_on", ...rows.map((c) => [c.name, c.email, c.phone, c.createdAt].map(esc).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "contacts.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Users className="h-5 w-5 text-primary" /> Contacts
            <span className="rounded-full bg-[#053877]/10 px-2 py-0.5 text-xs font-bold text-[#053877] dark:bg-white/10 dark:text-white">{rows.length}</span>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            People who asked to be reminded when your show is on. They get the reminder from us; the list is yours.
          </p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 rounded-full" onClick={download} disabled={!rows.length} data-testid="button-contacts-csv">
          <Download className="h-3.5 w-3.5" /> CSV
        </Button>
      </div>
      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">Nobody yet. Share your card and this fills up.</p>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm" data-testid={`contact-${c.id}`}>
                <span className="min-w-[10rem] font-medium text-foreground">{c.name || "—"}</span>
                <a href={`mailto:${c.email}`} className="min-w-[14rem] text-primary hover:underline">{c.email}</a>
                <span className="text-muted-foreground">{c.phone}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(c.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
