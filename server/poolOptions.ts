// How the postgres.js pool is configured. Its own file so the pool smoke test
// (scripts/pool-smoke.ts) can build a pool with exactly the options the app uses.

/**
 * `max_pipeline: 0` — one query on the wire per connection, never a queue of them.
 *
 * postgres.js pipelines: it writes up to 100 queued queries to a connection
 * before the first answer is back. Supabase's pooler in transaction mode (port
 * 6543, which we use) hands the backend to someone else after each query, and
 * cannot keep pipelined replies in order. Found 18 Nov 2026: under a burst
 * (the host dashboard's ~17 parallel requests, pool of 4) queries were
 * answered with *another query's* result or error, or never answered at all —
 * the requests hung for 40s+, the database sat idle with no lock waits, and
 * the whole server stayed wedged until restart. A bigger pool (DB_POOL_MAX=16)
 * only made it rarer. In isolation: 17 workers on 4 connections hung 17/17
 * with the default; with 0, 1,800 of 1,800 queries answered, 0 hung.
 * (1 is not enough: it still allows one query queued behind the active one.)
 *
 * Cost: a query waits for its connection's previous answer instead of riding
 * behind it. Negligible next to a round trip to the pooler.
 */
export function poolOptions(env: NodeJS.ProcessEnv = process.env) {
  return {
    prepare: false,
    max: Number(env.DB_POOL_MAX) || 4,
    max_pipeline: 0,
    idle_timeout: 20,
    connect_timeout: 10,
  } as const;
}
