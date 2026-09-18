import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Bold, Italic, Link2, List, ListOrdered, Undo2, Unlink } from "lucide-react";

// Write the email the way you'd write a document.
//
// The body is stored as plain text with markers — **bold**, [text](url), "- "
// bullets — because that is what the email renderer turns into table-based
// HTML that survives Outlook. Typing those markers by hand is a miserable way
// to write, so this edits the *rendered* version and converts back on the way
// out. What is stored never changes, so every email already written still
// opens, and the send path is untouched.
//
// contentEditable with execCommand rather than a rich-text library: the format
// here is four marks wide, and the browser's own implementation handles
// selection, undo and IME correctly in a way a hand-rolled one would not.
// execCommand is deprecated and still universally supported; if that changes
// the conversion functions below are the part worth keeping.

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => ESCAPE[c]);

/** Marker text → the HTML shown in the editor. */
export function markersToHtml(text: string): string {
  const NUM = /^\s*(\d+)[.)]\s+(.*)$/;
  const BUL = /^\s*[-*•]\s+(.*)$/;

  const inline = (s: string) =>
    escapeHtml(s)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, href) => `<a href="${href}">${label}</a>`)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      // Single asterisks are italics here; the renderer ignores them, so this
      // is shown but not promised — see htmlToMarkers, which drops them back
      // to plain text rather than inventing a marker the email can't render.
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");

  return text
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n").filter((l) => l.trim());
      if (!lines.length) return "";
      if (lines.every((l) => NUM.test(l))) {
        return `<ol>${lines.map((l) => `<li>${inline(l.match(NUM)![2])}</li>`).join("")}</ol>`;
      }
      if (lines.every((l) => BUL.test(l))) {
        return `<ul>${lines.map((l) => `<li>${inline(l.match(BUL)![1])}</li>`).join("")}</ul>`;
      }
      return `<p>${lines.map(inline).join("<br>")}</p>`;
    })
    .filter(Boolean)
    .join("");
}

/** The editor's HTML → the marker text we store and send. */
export function htmlToMarkers(root: HTMLElement): string {
  const inline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const inner = Array.from(el.childNodes).map(inline).join("");
    switch (el.tagName) {
      case "BR":
        return "\n";
      case "B":
      case "STRONG":
        return inner.trim() ? `**${inner}**` : inner;
      case "A": {
        const href = el.getAttribute("href") ?? "";
        return /^https?:\/\//i.test(href) ? `[${inner}](${href})` : inner;
      }
      // The email renderer has no italic mark, so rather than emit something
      // that would arrive as literal asterisks, the emphasis is dropped and
      // the words are kept.
      case "I":
      case "EM":
      default:
        return inner;
    }
  };

  const blocks: string[] = [];
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent ?? "").trim();
      if (t) blocks.push(t);
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as HTMLElement;
    if (el.tagName === "UL" || el.tagName === "OL") {
      const ordered = el.tagName === "OL";
      const items = Array.from(el.querySelectorAll(":scope > li")).map(
        (li, i) => `${ordered ? `${i + 1}. ` : "- "}${inline(li).trim()}`,
      );
      if (items.length) blocks.push(items.join("\n"));
      continue;
    }
    const text = inline(el).replace(/ /g, " ").trimEnd();
    if (text.trim()) blocks.push(text);
    // An empty <div> is someone pressing return twice; that's a paragraph
    // break, which the join below already provides.
  }
  return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

export function RichBody({ value, onChange, placeholder }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // What we last handed upward. Re-rendering the editor from our own output
  // would move the caret to the start on every keystroke.
  const emitted = useRef<string>("");
  const [active, setActive] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const el = ref.current;
    if (!el || value === emitted.current) return;
    el.innerHTML = markersToHtml(value);
  }, [value]);

  const push = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = htmlToMarkers(el);
    emitted.current = next;
    onChange(next);
  }, [onChange]);

  /** Which marks apply where the caret is, so the toolbar can light up. */
  const syncActive = useCallback(() => {
    if (typeof document.queryCommandState !== "function") return;
    try {
      setActive({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        insertUnorderedList: document.queryCommandState("insertUnorderedList"),
        insertOrderedList: document.queryCommandState("insertOrderedList"),
      });
    } catch {
      /* Safari throws when the selection is outside the document. */
    }
  }, []);

  function exec(command: string, arg?: string) {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    push();
    syncActive();
  }

  function addLink() {
    const sel = window.getSelection();
    const selected = sel?.toString() ?? "";
    const url = window.prompt("Link to where?", "https://");
    if (!url || !/^https?:\/\//i.test(url)) return;
    if (!selected) {
      // Nothing highlighted: insert the address as its own link rather than
      // silently doing nothing, which is what execCommand would do.
      exec("insertHTML", `<a href="${url}">${url}</a>`);
      return;
    }
    exec("createLink", url);
  }

  const tools = [
    { key: "bold", icon: Bold, label: "Bold", run: () => exec("bold"), shortcut: "⌘B" },
    { key: "italic", icon: Italic, label: "Italic", run: () => exec("italic"), shortcut: "⌘I" },
    { key: "link", icon: Link2, label: "Add link", run: addLink, shortcut: "⌘K" },
    { key: "unlink", icon: Unlink, label: "Remove link", run: () => exec("unlink") },
    { key: "insertUnorderedList", icon: List, label: "Bullets", run: () => exec("insertUnorderedList") },
    { key: "insertOrderedList", icon: ListOrdered, label: "Numbered list", run: () => exec("insertOrderedList") },
  ];

  return (
    <div className="rounded-md border border-input focus-within:ring-2 focus-within:ring-ring">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-input bg-muted/40 px-1.5 py-1">
        {tools.map((t) => (
          <Button
            key={t.key}
            type="button"
            size="icon"
            variant="ghost"
            title={`${t.label}${t.shortcut ? ` (${t.shortcut})` : ""}`}
            aria-label={t.label}
            aria-pressed={!!active[t.key]}
            className={`h-8 w-8 ${active[t.key] ? "bg-[#053877]/12 text-[#053877] dark:bg-white/15 dark:text-white" : ""}`}
            // Mousedown, not click: clicking a button blurs the editor and
            // takes the selection with it before the command can run.
            onMouseDown={(e) => {
              e.preventDefault();
              t.run();
            }}
            data-testid={`rich-${t.key}`}
          >
            <t.icon className="h-4 w-4" />
          </Button>
        ))}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          title="Undo (⌘Z)"
          aria-label="Undo"
          className="h-8 w-8"
          onMouseDown={(e) => { e.preventDefault(); exec("undo"); }}
        >
          <Undo2 className="h-4 w-4" />
        </Button>
        <span className="ml-auto pr-1.5 text-[11px] text-muted-foreground">
          Highlight text, then Bold or Add link
        </span>
      </div>

      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Email body"
        data-placeholder={placeholder}
        onInput={push}
        onBlur={push}
        onKeyUp={syncActive}
        onMouseUp={syncActive}
        onKeyDown={(e) => {
          const mod = e.metaKey || e.ctrlKey;
          if (!mod) return;
          const k = e.key.toLowerCase();
          if (k === "b") { e.preventDefault(); exec("bold"); }
          if (k === "i") { e.preventDefault(); exec("italic"); }
          if (k === "k") { e.preventDefault(); addLink(); }
        }}
        // Paste as plain text: pasting from a web page or Word otherwise
        // brings fonts, colours and spans none of which survive the
        // conversion, and all of which look broken in the editor first.
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, text);
          push();
        }}
        className="rich-body min-h-[22rem] w-full overflow-y-auto px-3 py-3 text-[15px] leading-relaxed outline-none"
        data-testid="rich-body"
      />
    </div>
  );
}
