import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Bold, Italic, Link2, List, ListOrdered, Undo2, Unlink, Heading1, Heading2, Pilcrow, Quote, Minus, Eraser } from "lucide-react";

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
  const BUL = /^\s*[-•]\s+(.*)$/;
  const HEAD = /^\s*(#{2,3})\s+(.*)$/;
  const QUOTE = /^\s*>\s?(.*)$/;
  const RULE = /^\s*-{3,}\s*$/;

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
      if (lines.length === 1 && RULE.test(lines[0])) return "<hr>";
      if (lines.length === 1 && HEAD.test(lines[0])) {
        const [, hashes, body] = lines[0].match(HEAD)!;
        return `<h${hashes.length}>${inline(body.trim())}</h${hashes.length}>`;
      }
      if (lines.every((l) => QUOTE.test(l))) {
        return `<blockquote>${lines.map((l) => inline(l.match(QUOTE)![1].trim())).join("<br>")}</blockquote>`;
      }
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
      case "I":
      case "EM":
        return inner.trim() ? `*${inner}*` : inner;
      // Underline is not offered and not emitted. In an email an underline
      // reads as a link people then try to click, and there is no marker for
      // it — anything pasted in underlined arrives as plain text instead.
      default:
        return inner;
    }
  };

  const BLOCK = new Set(["P", "DIV", "UL", "OL", "H1", "H2", "H3", "H4", "BLOCKQUOTE", "HR", "PRE", "SECTION", "ARTICLE", "LI"]);
  const hasBlockChild = (el: HTMLElement) =>
    Array.from(el.children).some((c) => BLOCK.has(c.tagName));

  /**
   * Walk blocks wherever they are, not only at the top level.
   *
   * contentEditable does not produce the tidy HTML this component writes. Ask
   * a browser for a bullet list and you often get <div><ul>…</ul></div>, and a
   * top-level-only loop walks straight past that <ul>, falls through to the
   * inline path, and concatenates the three items into one paragraph with no
   * separators and no markers — which is exactly what reached the preview.
   */
  const blocks: string[] = [];
  function collect(parent: HTMLElement | Element): void {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = (node.textContent ?? "").trim();
        if (t) blocks.push(t);
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as HTMLElement;

      if (el.tagName === "HR") {
        blocks.push("---");
        continue;
      }
      if (el.tagName === "H1" || el.tagName === "H2" || el.tagName === "H3" || el.tagName === "H4") {
        const t = inline(el).trim();
        if (t) blocks.push(`${el.tagName === "H1" || el.tagName === "H2" ? "##" : "###"} ${t}`);
        continue;
      }
      if (el.tagName === "BLOCKQUOTE") {
        const t = inline(el).trim();
        if (t) blocks.push(t.split("\n").map((l) => `> ${l.trim()}`).join("\n"));
        continue;
      }
      if (el.tagName === "UL" || el.tagName === "OL") {
        const ordered = el.tagName === "OL";
        // Direct children only, so a nested list doesn't get counted twice —
        // and by hand rather than with :scope, which linkedom and older
        // browsers do not implement.
        const items = Array.from(el.children)
          .filter((c) => c.tagName === "LI")
          .map((li, i) => `${ordered ? `${i + 1}. ` : "- "}${inline(li).trim()}`)
          .filter((t) => t.replace(/^(?:[-•]|\d+\.)\s*/, "").length > 0);
        if (items.length) blocks.push(items.join("\n"));
        continue;
      }

      // A wrapper around other blocks contributes nothing itself — descend.
      // A wrapper around only text and marks is a paragraph.
      if (hasBlockChild(el)) {
        collect(el);
        continue;
      }
      const text = inline(el).replace(/\u00a0/g, " ").trimEnd();
      if (text.trim()) blocks.push(text);
    }
  }
  collect(root);

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
      const tag = String(document.queryCommandValue("formatBlock") || "").toLowerCase();
      setActive({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        insertUnorderedList: document.queryCommandState("insertUnorderedList"),
        insertOrderedList: document.queryCommandState("insertOrderedList"),
        h2: tag === "h2",
        h3: tag === "h3",
        blockquote: tag === "blockquote",
        p: tag === "p" || tag === "div" || tag === "",
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

  /** Turn the block the caret is in into a heading, quote or plain paragraph. */
  function block(tag: "H2" | "H3" | "BLOCKQUOTE" | "P") {
    exec("formatBlock", `<${tag.toLowerCase()}>`);
  }

  const groups: { key: string; icon: typeof Bold; label: string; run: () => void; shortcut?: string }[][] = [
    [
      { key: "bold", icon: Bold, label: "Bold", run: () => exec("bold"), shortcut: "⌘B" },
      { key: "italic", icon: Italic, label: "Italic", run: () => exec("italic"), shortcut: "⌘I" },
      { key: "link", icon: Link2, label: "Add link", run: addLink, shortcut: "⌘K" },
      { key: "unlink", icon: Unlink, label: "Remove link", run: () => exec("unlink") },
    ],
    [
      { key: "h2", icon: Heading1, label: "Big heading", run: () => block("H2") },
      { key: "h3", icon: Heading2, label: "Small heading", run: () => block("H3") },
      { key: "p", icon: Pilcrow, label: "Normal text", run: () => block("P") },
    ],
    [
      { key: "insertUnorderedList", icon: List, label: "Bullets", run: () => exec("insertUnorderedList") },
      { key: "insertOrderedList", icon: ListOrdered, label: "Numbered list", run: () => exec("insertOrderedList") },
    ],
    [
      { key: "blockquote", icon: Quote, label: "Highlight box", run: () => block("BLOCKQUOTE") },
      { key: "hr", icon: Minus, label: "Divider line", run: () => exec("insertHTML", "<hr>") },
      { key: "removeFormat", icon: Eraser, label: "Clear formatting", run: () => exec("removeFormat") },
    ],
  ];

  return (
    <div className="rounded-md border border-input focus-within:ring-2 focus-within:ring-ring">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-input bg-muted/40 px-1.5 py-1">
        {groups.map((group, gi) => (
          <div key={gi} className="flex items-center gap-0.5">
            {gi > 0 && <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />}
            {group.map((t) => (
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
          </div>
        ))}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
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
        <Button
          type="button"
          size="sm"
          variant="ghost"
          title="Insert the recipient's first name"
          className="h-8 px-2 text-xs"
          onMouseDown={(e) => { e.preventDefault(); exec("insertText", "{{First_Name}}"); }}
          data-testid="rich-firstname"
        >
          First name
        </Button>
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
