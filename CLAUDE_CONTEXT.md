# MilitaryVoice.ai — Project Context

## What this is
A live event platform for military/veteran podcasters. Hosts sign-up pages, a broadcast email system, a CRM with lifecycle stages, and a studio control room.

## Stack
- **Frontend**: Vite + React + wouter + TanStack Query — `client/src/`
- **Backend**: Express API as Vercel function — `server/` → `api/index.ts`
- **DB**: Drizzle ORM + postgres-js on Supabase (`shared/schema.ts`). `schemaSync.ts` auto-creates tables on boot.
- **Email**: Resend (`server/email.ts`). `sendRawEmail` returns `string | null` (Resend message ID). Webhook at `/api/webhooks/resend`.
- **Auth**: Google OAuth + magic-link email codes. Admin gate = `storage.isAdminEmail()`.
- **Deploy**: Vercel (`vercel deploy --prod`). Env vars live in Vercel dashboard, not `.env`.

## Key files
- `client/src/pages/Admin.tsx` — all admin UI (CRM, broadcasts, contacts, AI draft)
- `server/routes.ts` — all API routes
- `server/storage.ts` — all DB queries
- `server/email.ts` — email sending + Resend API helpers
- `shared/schema.ts` — Drizzle schema (source of truth for DB shape)

## Important constraints
- **Secrets go in terminal only** — never paste API keys in chat: `read -rs K && printf '%s' "$K" | vercel env add NAME production && unset K`
- **Local `.env` hits PRODUCTION DB** — never create real bookings/plans for real accounts; always clean test rows
- **Vercel ESM runtime** — relative imports need `.js` extension; no fonts at runtime

## Current event
- **24-Hour Podcastathon** — Oct 5, 2026. Event ID = 1 in DB.
- One broadcast sent 9/16/2026 to 85 contacts (tracking retroactive sync pending).

## CRM lifecycle
`lead → engaged → signed_up → no_show → alumni` (only advances forward)

## Admin path
Sign in → Admin dashboard → select "24 Hour Podcastathon" → CRM tab → Broadcasts or Contacts
