import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require", max: 1 });
const rows = await sql`SELECT email, resend_id FROM broadcast_sends WHERE broadcast_id = 1 LIMIT 3`;
await sql.end();
for (const s of rows) console.log("stored id:", JSON.stringify(s.resend_id), "→", s.email);
const r = await fetch(`https://api.resend.com/emails/${rows[0].resend_id}`, {
  headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
});
console.log(r.status, (await r.text()).slice(0, 400));
