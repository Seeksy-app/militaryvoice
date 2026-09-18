// Put back the line breaks the old serialiser ate.
//
// Before the nested-block fix, a bullet list in the composer was written to
// the database as one run-on paragraph with the items concatenated and no
// separators. The code is fixed; the rows saved in between are not, and no
// amount of reopening them will restore what was dropped.
//
// The repair is deliberately narrow. It only splits where a bold run OPENS
// immediately after sentence-ending punctuation — "look your best.**Connect
// your Socials.**" — which cannot happen in text a person typed, and is the
// exact fingerprint of two <li> joined end to end. A normal "1. **Heading.**"
// also has ** after a full stop, but that ** is closing, so it is left alone.
//
//   npx tsx scripts/repair-flattened.ts           # show what would change
//   npx tsx scripts/repair-flattened.ts --apply   # write it
import "dotenv/config";
import postgres from "postgres";

const SIG = /([.!?:”"’'])(\*\*[A-Za-z])/g;

export function repair(body: string): string {
  if (!SIG.test(body)) return body;
  SIG.lastIndex = 0;

  return body
    .split(/\n{2,}/)
    .map((block) => {
      if (!/([.!?:”"’'])(\*\*[A-Za-z])/.test(block)) return block;
      // Split the run-on into its original items, then mark them up as the
      // list they were before they were flattened.
      const parts = block
        .replace(/([.!?:”"’'])(\*\*[A-Za-z])/g, "$1\n$2")
        .split("\n")
        .map((l) => l.replace(/\s{2,}/g, " ").trim())
        .filter(Boolean);
      return parts.map((l) => (/^\s*[-•]\s/.test(l) ? l : `- ${l}`)).join("\n");
    })
    .join("\n\n");
}

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const rows = await sql`SELECT id, subject, body_text FROM broadcasts ORDER BY id`;
const apply = process.argv.includes("--apply");
let changed = 0;

for (const r of rows) {
  const before = String(r.body_text);
  const after = repair(before);
  if (after === before) continue;
  changed++;
  console.log(`\n#${r.id} — ${String(r.subject).slice(0, 50)}`);
  console.log("  before:", JSON.stringify(before).slice(0, 260));
  console.log("  after :", JSON.stringify(after).slice(0, 260));
  if (apply) {
    await sql`UPDATE broadcasts SET body_text = ${after} WHERE id = ${r.id} AND status <> 'sent'`;
    console.log("  → written");
  }
}
await sql.end();
console.log(`\n${changed} row${changed === 1 ? "" : "s"} ${apply ? "repaired" : "would change"}.`);
