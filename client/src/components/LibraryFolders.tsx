import { createContext, useContext, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Folder, FolderInput, FolderOpen, FolderPlus, Library, Pencil, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { LibraryFolderRow } from "@shared/schema";

/**
 * The Library's folders: one set for everything in it (recorded episodes,
 * podcast episodes and clips, 20 Nov 2026). The bar sits above the Library's
 * tabs, so a card from any tab drags onto the same chips; every card's ⋯ menu
 * has the same Move to folder; an open folder shows all it holds.
 */
export type Fileable = { kind: "recording" | "episode" | "clip"; id: number };

const DRAG = "text/x-mv-library";
const URL_OF: Record<Fileable["kind"], string> = { recording: "recordings", episode: "podcast-episodes", clip: "clips" };

type Ctx = {
  folders: LibraryFolderRow[];
  /** The open folder; null for the whole Library. */
  open: number | null;
  setOpen: (id: number | null) => void;
  file: (item: Fileable, folderId: number) => Promise<void>;
  /** Name a new folder in the bar; with an item, file it there once it's made. */
  newFolder: (item?: Fileable) => void;
};
const FoldersCtx = createContext<Ctx | null>(null);
const BarCtx = createContext<{ naming: Naming; setNaming: (n: Naming) => void } | null>(null);
type Naming = { id: number | null; name: string; file?: Fileable } | null;

export function useLibraryFolders() {
  return useContext(FoldersCtx);
}

export function LibraryFoldersProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [openId, setOpen] = useState<number | null>(null);
  const [naming, setNaming] = useState<Naming>(null);
  const q = useQuery<LibraryFolderRow[]>({ queryKey: ["/api/host/folders"], queryFn: async () => (await apiRequest("GET", "/api/host/folders")).json() });
  const folders = q.data ?? [];
  // A folder deleted elsewhere just stops being open.
  const open = openId != null && folders.some((f) => f.id === openId) ? openId : null;

  async function file(item: Fileable, folderId: number) {
    try {
      await apiRequest("POST", `/api/host/${URL_OF[item.kind]}/${item.id}/folder`, { folderId });
      await Promise.all(["/api/host/recordings", "/api/host/podcast-episodes", "/api/host/clips"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      const f = folders.find((x) => x.id === folderId) ?? (await qc.fetchQuery<LibraryFolderRow[]>({ queryKey: ["/api/host/folders"] })).find((x) => x.id === folderId);
      toast({ title: folderId && f ? `Moved to ${f.name}` : "Taken out of its folder" });
    } catch (err) {
      toast({ title: "Couldn't move that", description: (err as Error).message.replace(/^\d+:\s*/, ""), variant: "destructive" });
    }
  }

  return (
    <FoldersCtx.Provider value={{ folders, open, setOpen, file, newFolder: (item) => setNaming({ id: null, name: "", file: item }) }}>
      <BarCtx.Provider value={{ naming, setNaming }}>{children}</BarCtx.Provider>
    </FoldersCtx.Provider>
  );
}

/** What makes a card draggable onto a folder chip (pass useLibraryFolders()). Only once there's a folder to drop it on. */
export function dragToFolder(lib: Ctx | null, item: Fileable) {
  if (!lib || lib.folders.length === 0) return {};
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData(DRAG, JSON.stringify(item)); e.dataTransfer.effectAllowed = "move"; },
  };
}

/** The bar: All, each folder (click to open, drop to file), New folder; Rename and Delete for the open one. */
export function FolderBar({ counts }: { counts: Map<number, number> }) {
  const lib = useLibraryFolders();
  const bar = useContext(BarCtx);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [over, setOver] = useState<number | null>(null);
  const [removing, setRemoving] = useState<LibraryFolderRow | null>(null);
  if (!lib || !bar) return null;
  const { folders, open, setOpen, file } = lib;
  const { naming, setNaming } = bar;

  async function save() {
    if (!naming) return;
    const name = naming.name.trim();
    if (!name) return setNaming(null);
    try {
      const res = naming.id == null ? await apiRequest("POST", "/api/host/folders", { name }) : await apiRequest("PATCH", `/api/host/folders/${naming.id}`, { name });
      const row = (await res.json()) as LibraryFolderRow;
      await qc.invalidateQueries({ queryKey: ["/api/host/folders"] });
      if (naming.file) await file(naming.file, row.id);
      else if (naming.id == null) setOpen(row.id);
      setNaming(null);
    } catch (err) {
      toast({ title: "Couldn't save that folder", description: (err as Error).message.replace(/^\d+:\s*/, ""), variant: "destructive" });
    }
  }
  const drop = (folderId: number) => (e: React.DragEvent) => {
    e.preventDefault();
    setOver(null);
    try {
      const item = JSON.parse(e.dataTransfer.getData(DRAG)) as Fileable;
      if (item?.kind && item.id) void file(item, folderId);
    } catch { /* not one of ours */ }
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="library-folders">
      <Chip active={open == null} onClick={() => setOpen(null)} icon={<Library className="h-3.5 w-3.5" />} label="All" testId="folder-all" />
      {folders.map((f) =>
        naming?.id === f.id ? (
          <NameInput key={f.id} value={naming.name} onChange={(name) => setNaming({ ...naming, name })} onSave={save} onCancel={() => setNaming(null)} />
        ) : (
          <Chip
            key={f.id}
            active={open === f.id}
            over={over === f.id}
            onClick={() => setOpen(f.id)}
            icon={open === f.id ? <FolderOpen className="h-3.5 w-3.5" /> : <Folder className="h-3.5 w-3.5" />}
            label={f.name}
            n={counts.get(f.id) ?? 0}
            onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG)) { e.preventDefault(); setOver(f.id); } }}
            onDragLeave={() => setOver(null)}
            onDrop={drop(f.id)}
            testId={`folder-${f.id}`}
          />
        ),
      )}
      {naming?.id === null ? (
        <NameInput value={naming.name} onChange={(name) => setNaming({ ...naming, name })} onSave={save} onCancel={() => setNaming(null)} />
      ) : (
        <button type="button" onClick={() => setNaming({ id: null, name: "" })} className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:border-foreground/40 hover:text-foreground" data-testid="button-new-folder">
          <FolderPlus className="h-3.5 w-3.5" /> New folder
        </button>
      )}
      {open != null && naming?.id !== open && (
        <span className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-7 gap-1 rounded-full px-2.5 text-xs" onClick={() => setNaming({ id: open, name: folders.find((f) => f.id === open)?.name ?? "" })} data-testid="button-rename-folder">
            <Pencil className="h-3 w-3" /> Rename
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1 rounded-full px-2.5 text-xs text-muted-foreground hover:text-destructive" onClick={() => setRemoving(folders.find((f) => f.id === open) ?? null)} data-testid="button-delete-folder">
            <Trash2 className="h-3 w-3" /> Delete folder
          </Button>
        </span>
      )}
      <ConfirmDelete
        open={!!removing}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={`Delete the "${removing?.name ?? ""}" folder?`}
        description="Only the folder goes. What's in it stays in your Library."
        url={`/api/host/folders/${removing?.id}`}
        onDeleted={() => {
          setOpen(null);
          for (const k of ["/api/host/folders", "/api/host/recordings", "/api/host/podcast-episodes", "/api/host/clips"]) void qc.invalidateQueries({ queryKey: [k] });
        }}
      />
    </div>
  );
}

/** The ⋯ menu's Move to folder, the same on every card. */
export function MoveToFolder({ item, current }: { item: Fileable; current: number }) {
  const lib = useLibraryFolders();
  if (!lib) return null;
  const { folders, file, newFolder } = lib;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-2" data-testid={`button-move-${item.kind}-${item.id}`}>
        <FolderInput className="h-4 w-4" /> Move to folder
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-48">
        {folders.map((f) => (
          <DropdownMenuItem key={f.id} onSelect={() => void file(item, f.id)} className="gap-2">
            <Folder className="h-4 w-4" /> <span className="truncate">{f.name}</span>
            {current === f.id && <Check className="ml-auto h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
        {current > 0 && (
          <DropdownMenuItem onSelect={() => void file(item, 0)} className="gap-2">
            <X className="h-4 w-4" /> Out of the folder
          </DropdownMenuItem>
        )}
        {(folders.length > 0 || current > 0) && <DropdownMenuSeparator />}
        <DropdownMenuItem onSelect={() => newFolder(item)} className="gap-2">
          <FolderPlus className="h-4 w-4" /> New folder…
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function Chip({ active, over, onClick, icon, label, n, onDragOver, onDragLeave, onDrop, testId }: {
  active: boolean;
  over?: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  /** How many it holds; none on All. */
  n?: number;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      aria-pressed={active}
      className={`inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
        over ? "border-[#F0A71F] bg-[#F0A71F]/15 text-foreground" : active ? "border-[#000741] bg-[#000741] text-white dark:border-white dark:bg-white dark:text-[#000741]" : "border-border bg-card text-muted-foreground hover:text-foreground"
      }`}
      data-testid={testId}
    >
      {icon} <span className="truncate">{label}</span> {n != null && <span className={`tabular-nums ${active ? "opacity-70" : ""}`}>{n}</span>}
    </button>
  );
}

function NameInput({ value, onChange, onSave, onCancel }: { value: string; onChange: (v: string) => void; onSave: () => void; onCancel: () => void }) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(); }} className="inline-flex items-center gap-1">
      <Input
        autoFocus
        value={value}
        maxLength={60}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        placeholder="Folder name"
        className="h-8 w-44 rounded-full text-xs"
        data-testid="input-folder-name"
      />
      <Button type="submit" size="sm" className="h-8 rounded-full px-3 text-xs" data-testid="button-save-folder">Save</Button>
      <Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-full" onClick={onCancel} aria-label="Cancel"><X className="h-3.5 w-3.5" /></Button>
    </form>
  );
}
