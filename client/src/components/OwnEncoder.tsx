import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Cable, Copy, Eye, EyeOff, RefreshCw } from "lucide-react";

// For podcasters who already run OBS, StreamYard, Riverside or similar and
// would rather push their own produced feed than use our studio page. We give
// them an RTMP URL and key; their feed arrives in the room as an ordinary
// participant and the producer brings them on stage like anyone else.

interface Payload {
  configured: boolean;
  ingress: { id: number; url: string; streamKey: string; displayName: string } | null;
}

function CopyField({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const { toast } = useToast();
  const [shown, setShown] = useState(!secret);

  return (
    <div>
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div className="mt-1 flex items-center gap-2">
        <Input
          readOnly
          value={shown ? value : "•".repeat(Math.min(value.length, 32))}
          className="font-mono text-xs"
          onFocus={(e) => shown && e.currentTarget.select()}
        />
        {secret && (
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => setShown((v) => !v)}
            aria-label={shown ? "Hide" : "Show"}
          >
            {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
        )}
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() =>
            navigator.clipboard.writeText(value).then(
              () => toast({ title: `${label} copied` }),
              () => toast({ title: "Couldn't copy", variant: "destructive" }),
            )
          }
          aria-label={`Copy ${label}`}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function OwnEncoder() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data } = useQuery<Payload>({
    queryKey: ["/api/host/ingress"],
    queryFn: async () => (await apiRequest("GET", "/api/host/ingress")).json(),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/host/ingress"] });
  const fail = (e: Error) => toast({ title: "That didn't work", description: e.message, variant: "destructive" });

  const create = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/host/ingress"),
    onSuccess: () => {
      refresh();
      setOpen(true);
    },
    onError: fail,
  });
  const reset = useMutation({
    mutationFn: async () => apiRequest("DELETE", "/api/host/ingress"),
    onSuccess: refresh,
    onError: fail,
  });

  if (data && !data.configured) return null;
  const ing = data?.ingress ?? null;

  return (
    <section className="mt-8 rounded-2xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Cable className="h-4.5 w-4.5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-card-foreground">Use your own gear</h2>
            <p className="max-w-xl text-sm text-muted-foreground">
              Happy in our studio page? Ignore this. If you already run OBS, StreamYard, Riverside or similar, you can
              stream your own feed in instead — with your cameras, your overlays, your sound.
            </p>
          </div>
        </div>

        {!ing && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 rounded-full"
            disabled={create.isPending}
            onClick={() => create.mutate()}
            data-testid="button-create-ingress"
          >
            <Cable className="h-3.5 w-3.5" /> {create.isPending ? "Setting up…" : "Get my stream key"}
          </Button>
        )}
      </div>

      {ing && (
        <>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <CopyField label="Server URL" value={ing.url} />
            <CopyField label="Stream key" value={ing.streamKey} secret />
          </div>

          <div className="mt-4 rounded-xl border border-border bg-muted/40 p-4">
            <button
              type="button"
              className="text-sm font-medium text-primary hover:underline"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "Hide setup steps" : "How to point your software at this"}
            </button>
            {open && (
              <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-sm text-muted-foreground">
                <li>In your software, choose <strong>Custom RTMP</strong> as the destination (in OBS: Settings → Stream → Service: Custom).</li>
                <li>Paste the server URL and the stream key above.</li>
                <li>Set your output to <strong>1920×1080 at 30fps</strong>, around 4000&nbsp;kbps, keyframe interval 2 seconds.</li>
                <li>Start streaming about <strong>ten minutes before your slot</strong>. You'll land in the green room, not on air.</li>
                <li>We bring you on when it's your turn. Keep streaming the whole way through — if you stop, you drop out of the show.</li>
              </ol>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-muted-foreground"
              disabled={reset.isPending}
              onClick={() => reset.mutate()}
              data-testid="button-reset-ingress"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Start a new key
            </Button>
            <p className="text-xs text-muted-foreground">
              Treat the key like a password. If it gets out, start a new one and the old stops working.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
