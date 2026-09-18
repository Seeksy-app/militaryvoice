import postgres from 'postgres';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
if (!RESEND_API_KEY) { console.error('RESEND_API_KEY not set'); process.exit(1); }

const sql = postgres(process.env.POSTGRES_URL);
const BROADCAST_ID = 1;

const res = await fetch('https://api.resend.com/emails?limit=100', {
  headers: { Authorization: `Bearer ${RESEND_API_KEY}` }
});
const data = await res.json();
const emails = data.data || [];
console.log(`Fetched ${emails.length} emails from Resend`);

let matched = 0;
for (const s of emails) {
  const email = s.to?.[0];
  if (!email) continue;
  await sql`
    INSERT INTO broadcast_sends (broadcast_id, email, resend_id, sent_at)
    VALUES (${BROADCAST_ID}, ${email}, ${s.id}, ${s.created_at})
    ON CONFLICT DO NOTHING
  `;
  matched++;
  if (s.last_event) {
    await sql`
      INSERT INTO broadcast_events (resend_id, event_type, occurred_at, url)
      VALUES (${s.id}, ${s.last_event}, ${s.created_at}, '')
      ON CONFLICT DO NOTHING
    `.catch(() => {});
  }
}

console.log(`Synced ${matched} send records`);
await sql.end();
