// Find bodies where a list was flattened into a paragraph.
//
// The signature is unmistakable: a sentence ends and the next item's bold
// lead-in starts with no space and no newline between them — "look your
// best.**Connect your Socials.**" — which is what happens when three <li>
// are concatenated with nothing in between.
import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const rows = await sql`SELECT id, subject, body_text FROM broadcasts ORDER BY id`;
// A ** that OPENS a bold run immediately after sentence-ending punctuation.
// The closing ** of a normal "1. **Heading.**" also sits after a full stop,
// which is why the first pass at this flagged every correctly-formatted list
// in the cadence — the discriminator is what comes next: a letter means the
// run is opening, whitespace means it is closing.
const SIG = /[.!?:”"’'][*][*][A-Za-z]/g;
for (const r of rows) {
  const body = String(r.body_text);
  const hits = [...body.matchAll(SIG)];
  if (!hits.length) continue;
  console.log(`#${r.id} — ${hits.length} run-together item(s) — ${String(r.subject).slice(0, 40)}`);
  for (const h of hits) {
    console.log(`    …${body.slice(Math.max(0, h.index! - 34), h.index! + 34).replace(/\n/g, "\\n")}…`);
  }
}
await sql.end();
