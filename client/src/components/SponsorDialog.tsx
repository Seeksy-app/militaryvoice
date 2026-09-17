import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
}

/** "Sponsors" nav item: a short form that reaches the admin team by email. */
export function SponsorDialog({
  children,
  eyebrow = "Become a sponsor",
  title = "Put your brand in front of the whole 24 hours.",
  description = "Sponsor logos run in the “Friends of the Podcastathon” strip on every page and get read on air between shows. Tell us a little about you and we'll send the packages.",
  sentTitle = "Thanks — we'll be in touch",
  sentDescription = "The team gets your note by email right away.",
  footNote = "We'll reply by email. No list, no spam.",
  showNotes = true,
}: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
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
        turnstileToken: human,
      });
      return res.json();
    },
    onSettled: () => setHumanReset((n) => n + 1),
    onSuccess: () => {
      setSent(true);
      toast({ title: sentTitle, description: sentDescription });
      setTimeout(() => {
        setOpen(false);
        setSent(false);
        setName("");
        setCompany("");
        setJobTitle("");
        setEmail("");
        setPhone("");
        setMessage("");
      }, 1600);
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

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) mutation.mutate();
          }}
          className="flex flex-col gap-4"
        >
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
      </DialogContent>
    </Dialog>
  );
}
