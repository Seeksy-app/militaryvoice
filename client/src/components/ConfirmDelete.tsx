import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

/** "Delete this?" with the consequence spelled out, then the DELETE, then fresh lists. */
export function ConfirmDelete({ open, onOpenChange, title, description, url, onDeleted }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  url: string;
  onDeleted?: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await apiRequest("DELETE", url);
      for (const k of ["/api/host/recordings", "/api/host/clips", "/api/host/posts"]) void qc.invalidateQueries({ queryKey: [k] });
      onDeleted?.();
      onOpenChange(false);
      toast({ title: "Deleted" });
    } catch (e) {
      toast({ title: "Couldn't delete that", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
          <AlertDialogAction onClick={(e) => { e.preventDefault(); void go(); }} disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="confirm-delete">
            {busy ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
