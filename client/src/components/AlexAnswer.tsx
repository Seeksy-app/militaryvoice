import { Fragment, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { showGuide } from "@/components/Guide";
import { guideTarget } from "@shared/guideTargets";

// How an Alex answer reads in the chat (PM for Andrew, 24 Nov: "Yes, fix Alex"): numbered steps as a real list,
// **bold** button and tab names as bold, and the page to go to as a button, never a path in the words.

export type HelpAction = { label: string; href: string; guide?: string };

// Site paths and full URLs still become links in what the team writes back by hand.
const LINK_RE = /(https?:\/\/[^\s)]+|(?<![\w/])\/(?:schedule|agenda|prepare|faq|platform|about|sponsors|host\/dashboard(?:\/[\w-]+)?|help(?:\/[\w-]+)?(?:#[\w-]+)?|discover|directory|for-brands|tour|studio|watch|s\/\d+|event\/[\w-]+(?:\/[\w-]+)?)(?![\w/-]))/g;
const linkCls = "font-medium underline underline-offset-2 text-primary hover:opacity-80";

function linkify(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of Array.from(text.matchAll(LINK_RE))) {
    const start = m.index ?? 0;
    const raw = m[0];
    const trimmed = raw.replace(/[.,;:!?]+$/, "");
    const trail = raw.slice(trimmed.length);
    if (start > last) out.push(text.slice(last, start));
    const k = `${key}-${start}`;
    if (/^https?:\/\//.test(trimmed)) {
      let internal = false;
      try {
        internal = new URL(trimmed).host.replace(/^www\./, "") === window.location.host.replace(/^www\./, "");
      } catch {
        /* leave external */
      }
      out.push(internal
        ? <Link key={k} href={new URL(trimmed).pathname + new URL(trimmed).search} className={linkCls}>{trimmed}</Link>
        : <a key={k} href={trimmed} target="_blank" rel="noopener noreferrer" className={linkCls}>{trimmed}</a>);
    } else {
      out.push(<Link key={k} href={trimmed} className={linkCls}>{trimmed}</Link>);
    }
    if (trail) out.push(trail);
    last = start + raw.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** One line: **bold** as bold, links as links. */
function inline(line: string, key: string): ReactNode[] {
  return line.split(/(\*\*[^*\n]+\*\*)/g).flatMap<ReactNode>((part, i) =>
    /^\*\*[^*]+\*\*$/.test(part)
      ? [<strong key={`${key}b${i}`} className="font-semibold">{part.slice(2, -2)}</strong>]
      : linkify(part, `${key}t${i}`),
  );
}

/** The words of an answer: numbered lines become a list, the rest paragraphs. */
export function AnswerBody({ text }: { text: string }) {
  const blocks: ({ kind: "p"; line: string } | { kind: "ol"; items: string[] })[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const step = line.match(/^\d+[.)]\s+(.*)$/);
    const prev = blocks[blocks.length - 1];
    if (step) {
      if (prev?.kind === "ol") prev.items.push(step[1]);
      else blocks.push({ kind: "ol", items: [step[1]] });
    } else blocks.push({ kind: "p", line });
  }
  return (
    <div className="space-y-1.5">
      {blocks.map((b, i) =>
        b.kind === "ol" ? (
          <ol key={i} className="list-decimal space-y-1 pl-5 marker:font-semibold">
            {b.items.map((it, j) => <li key={j} className="pl-0.5">{inline(it, `${i}.${j}`)}</li>)}
          </ol>
        ) : (
          <p key={i}>{inline(b.line, String(i))}</p>
        ),
      )}
    </div>
  );
}

/** "Take me there" goes to the page and points at the control; "Read the full guide" opens the help article. */
export function AnswerActions({ actions, onGo, who }: { actions?: HelpAction[]; onGo?: () => void; who?: { name: string; avatarUrl?: string } }) {
  const [, navigate] = useLocation();
  if (!actions?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2" data-testid="help-actions">
      {actions.map((a, i) => (
        <Fragment key={a.href + i}>
          <button
            type="button"
            onClick={() => {
              navigate(a.href);
              onGo?.();
              const t = a.guide ? guideTarget(a.guide) : undefined;
              if (t) window.setTimeout(() => showGuide(t.steps, undefined, who ?? { name: "Alex", avatarUrl: "/alex.jpg" }), 500);
            }}
            className={i === 0
              ? "rounded-full bg-[#053877] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#053877]/90"
              : "rounded-full border border-[#053877]/30 bg-white px-3.5 py-1.5 text-xs font-semibold text-[#053877] hover:bg-[#053877]/5 dark:bg-transparent dark:text-[#8ab4f8]"}
            data-testid={`help-action-${i}`}
          >
            {a.label}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
