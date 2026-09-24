import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Turnstile, useTurnstileSiteKey } from "@/components/Turnstile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const HEADLINE_FONT = { fontFamily: "'General Sans', 'Inter', sans-serif" } as const;

/** Beta / event-registration capture. Both buttons open the same short form. */
export function InterestDialog({
  trigger,
  intent,
}: {
  trigger: React.ReactNode;
  intent: "register" | "beta";
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [org, setOrg] = useState("");
  const [when, setWhen] = useState("");
  const [about, setAbout] = useState("");
  const siteKey = useTurnstileSiteKey();
  const [human, setHuman] = useState<string | null>(null);
  const [humanReset, setHumanReset] = useState(0);

  const submit = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/platform-interest", {
        intent,
        name: name.trim(),
        email: email.trim(),
        organization: org.trim(),
        eventTiming: when,
        notes: about.trim(),
        turnstileToken: human,
      }),
    onSettled: () => setHumanReset((n) => n + 1),
    onSuccess: () => {
      setOpen(false);
      setName("");
      setEmail("");
      setOrg("");
      setWhen("");
      setAbout("");
      toast({
        title: intent === "register" ? "Event registered" : "You're on the list",
        description: "We'll be in touch shortly.",
      });
    },
    onError: (e: Error) => toast({ title: "Couldn't send that", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle style={HEADLINE_FONT}>
            {intent === "register" ? "Tell us about your event" : "Get on the beta list"}
          </DialogTitle>
          <DialogDescription>
            {intent === "register"
              ? "A few details and we'll come back with what running it on MilitaryVoices.ai would look like."
              : "We're onboarding organizations in small groups. Tell us who you are and we'll be in touch."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && email.trim()) submit.mutate();
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="pi-name">Your name *</Label>
              <Input id="pi-name" className="mt-1" value={name} onChange={(e) => setName(e.target.value)} required data-testid="input-interest-name" />
            </div>
            <div>
              <Label htmlFor="pi-email">Email *</Label>
              <Input id="pi-email" type="email" className="mt-1" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="input-interest-email" />
            </div>
          </div>
          <div>
            <Label htmlFor="pi-org">Organization</Label>
            <Input id="pi-org" className="mt-1" value={org} onChange={(e) => setOrg(e.target.value)} data-testid="input-interest-org" />
          </div>
          <div>
            <Label>When's your next event?</Label>
            <Select value={when || undefined} onValueChange={setWhen}>
              <SelectTrigger className="mt-1" data-testid="select-interest-timing">
                <SelectValue placeholder="Pick a rough timeframe" />
              </SelectTrigger>
              <SelectContent>
                {["Within a month", "1–3 months", "3–6 months", "Later this year", "No date yet"].map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="pi-about">What are you planning?</Label>
            <Textarea
              id="pi-about"
              rows={3}
              className="mt-1"
              placeholder="Format, rough size, anything you already know."
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              data-testid="input-interest-notes"
            />
          </div>
          {siteKey && <Turnstile siteKey={siteKey} onToken={setHuman} resetSignal={humanReset} />}
          <Button
            type="submit"
            disabled={submit.isPending || !name.trim() || !email.trim() || (Boolean(siteKey) && !human)}
            className="rounded-full"
            data-testid="button-interest-submit"
          >
            {submit.isPending ? "Sending…" : intent === "register" ? "Register my event" : "Join the beta list"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

