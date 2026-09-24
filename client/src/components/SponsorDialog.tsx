import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Handshake, Check, Send } from "lucide-react";
import { Turnstile, useTurnstileSiteKey } from "@/components/Turnstile";

interface SponsorPackage {
  id: number;
  name: string;
  price: number;
  tier: string;
  description: string;
}

interface Props {
  children: React.ReactNode;
  /** Copy overrides, so a specific pitch can name itself and who replies. */
  eyebrow?: string;
  title?: string;
  description?: string;
  /** Shown in the toast once it sends. */
  sentTitle?: string;
  sentDescription?: string;
  footNote?: string;
  /** Some pitches only need who they are and how to reach them. */
  showNotes?: boolean;
  /** Open as soon as the page loads — for a link sent straight to a prospect. */
  defaultOpen?: boolean;
  /** Pre-select a package by id. */
  defaultPackageId?: number;
}

/** "Sponsors" nav item: a short form that reaches the admin team by email. */
export function SponsorDialog({
  children,
  eyebrow = "Become a sponsor",
  title = "Put your brand in front of the whole 26.2.",
  description = "Sponsor logos run in the “Friends of the Marathon” strip on every page and get read on air between shows. Tell us a little about you and we'll send the packages.",
  sentTitle = "Thanks — we'll be in touch",
  sentDescription = "The team gets your note by email right away.",
  footNote = "We'll reply by email. No list, no spam.",
  showNotes = true,
  defaultOpen = false,
  defaultPackageId = 0,
}: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(defaultOpen);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [packageId, setPackageId] = useState(defaultPackageId);
  const [sent, setSent] = useState(false);
  const [paid, setPaid] = useState<{ url: string; label: string } | null>(null);

  // The tiers, if there are any. Until somebody fills them in this query
  // returns nothing and the form is exactly what it was — which is the right
  // failure mode for a picker whose options live in an admin screen.
  const { data: packages = [] } = useQuery<SponsorPackage[]>({
    queryKey: ["/api/sponsor-packages"],
    queryFn: async () => (await apiRequest("GET", "/api/sponsor-packages")).json(),
    staleTime: 5 * 60 * 1000,
  });
  const siteKey = useTurnstileSiteKey();
  const [human, setHuman] = useState<string | null>(null);
  const [humanReset, setHumanReset] = useState(0);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sponsor-inquiries", {
        name,
        company,
        title: jobTitle,
        email,
        phone,
        message,
        packageId,
        turnstileToken: human,
      });
      return res.json();
    },
    onSettled: () => setHumanReset((n) => n + 1),
    onSuccess: (r: { checkoutUrl?: string; packageName?: string }) => {
      setSent(true);
      setPaid({ url: r?.checkoutUrl ?? "", label: r?.packageName ?? "" });
      toast({ title: sentTitle, description: sentDescription });
      // Only close itself when there is nothing left to do. With a payment
      // link on screen, closing the dialog out from under someone two seconds
      // after handing them one is the whole funnel thrown away.
      if (!r?.checkoutUrl) {
        setTimeout(() => {
          setOpen(false);
          setSent(false);
          setName("");
          setCompany("");
          setJobTitle("");
          setEmail("");
          setPhone("");
          setMessage("");
          setPackageId(0);
        }, 1600);
      }
    },
    onError: (err: Error) => toast({ title: "Couldn't send that", description: err.message, variant: "destructive" }),
  });

  const canSubmit = name.trim().length > 0 && /\S+@\S+\.\S+/.test(email) && (!siteKey || Boolean(human));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-sponsor">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2 text-primary">
            <Handshake className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-[0.14em]">{eyebrow}</span>
          </div>
          <DialogTitle className="text-xl" style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {paid?.url ? (
          <div className="flex flex-col items-center gap-4 py-2 text-center" data-testid="sponsor-checkout">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Check className="h-6 w-6 text-primary" />
            </span>
            <div>
              <p className="text-base font-semibold">We've got it — thanks.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {paid.label ? <>You picked <span className="font-medium text-foreground">{paid.label}</span>. </> : null}
                Our sponsor team will be in touch about your creative. If you'd like to lock it in now:
              </p>
            </div>
            <Button asChild size="lg" className="w-full gap-2 rounded-full">
              <a href={paid.url} target="_blank" rel="noreferrer" data-testid="link-sponsor-checkout">
                Complete your sponsorship
              </a>
            </Button>
            <p className="text-xs text-muted-foreground">
              We've emailed you the same link — no rush, it stays good.
            </p>
          </div>
        ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) mutation.mutate();
          }}
          className="flex flex-col gap-4"
        >
          {/* Asked first, because it is the question they came with. A prospect
              who has already decided which tier interests them is a different
              conversation from one who wants to be talked through it, and
              knowing which before you call is most of the value. */}
          {packages.length > 0 && (
            <div>
              <Label className="text-xs">Which package interests you?</Label>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                {packages.map((pk) => {
                  const picked = packageId === pk.id;
                  return (
                    <button
                      key={pk.id}
                      type="button"
                      onClick={() => setPackageId(picked ? 0 : pk.id)}
                      aria-pressed={picked}
                      className={`rounded-xl border p-3 text-left transition-colors ${
                        picked ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                      }`}
                      data-testid={`button-sponsor-package-${pk.id}`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold">{pk.name}</span>
                        {pk.price > 0 && (
                          <span className="shrink-0 text-sm font-bold tabular-nums text-primary">
                            ${pk.price.toLocaleString()}
                          </span>
                        )}
                      </div>
                      {pk.description && (
                        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{pk.description}</p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="sp-name" className="text-xs">
                Your name <span className="text-destructive">*</span>
              </Label>
              <Input id="sp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jamie Rivera" className="mt-1" data-testid="input-sponsor-inq-name" />
            </div>
            <div>
              <Label htmlFor="sp-company" className="text-xs">
                Company
              </Label>
              <Input id="sp-company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Dept. of Hydration" className="mt-1" data-testid="input-sponsor-inq-company" />
            </div>
            <div>
              <Label htmlFor="sp-title" className="text-xs">
                Your title
              </Label>
              <Input id="sp-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Director of Communications" className="mt-1" data-testid="input-sponsor-inq-title" />
            </div>
            <div>
              <Label htmlFor="sp-email" className="text-xs">
                Email <span className="text-destructive">*</span>
              </Label>
              <Input id="sp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="mt-1" data-testid="input-sponsor-inq-email" />
            </div>
            <div>
              <Label htmlFor="sp-phone" className="text-xs">
                Phone
              </Label>
              <Input id="sp-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-5555" className="mt-1" data-testid="input-sponsor-inq-phone" />
            </div>
          </div>
          {showNotes && (
          <div>
            <Label htmlFor="sp-message" className="text-xs">
              Anything you'd like us to know
            </Label>
            <Textarea
              id="sp-message"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What you'd like to get out of it, budget range, questions…"
              className="mt-1"
              data-testid="input-sponsor-inq-message"
            />
          </div>
          )}
          {siteKey && <Turnstile siteKey={siteKey} onToken={setHuman} resetSignal={humanReset} />}
          <DialogFooter className="gap-2 sm:justify-between">
            <p className="text-xs text-muted-foreground">{footNote}</p>
            <Button type="submit" disabled={mutation.isPending || !canSubmit || sent} className="gap-1.5 rounded-full" data-testid="button-sponsor-inq-submit">
              {sent ? (
                <>
                  <Check className="h-4 w-4" /> Sent
                </>
              ) : mutation.isPending ? (
                "Sending…"
              ) : (
                <>
                  <Send className="h-4 w-4" /> Send
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
