import { createHash } from "node:crypto";
import { getTableConfig } from "drizzle-orm/pg-core";
import type { PgColumn } from "drizzle-orm/pg-core";
import * as schema from "../shared/schema.js";

/**
 * Bring the database up to whatever shared/schema.ts currently declares.
 *
 * The hand-written migration drifted from the schema repeatedly — events.slug,
 * signups.rss_url, the nudges unique index — because adding a column meant
 * remembering to add DDL in a second place. Nobody remembers. So the DDL is
 * derived from the schema itself: every table, every column, every declared
 * index, created if absent. Add a column to the schema and it appears here.
 *
 * Everything is idempotent, so it is safe on every boot and on a database that
 * is already correct.
 */

type Sql = { unsafe: (q: string) => Promise<any> };

/** SQL literal for a column default drizzle gives us as a JS value. */
function defaultLiteral(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

function columnDdl(col: PgColumn, forCreate: boolean): string {
  const type = col.getSQLType();
  // A serial primary key carries its own sequence and constraint.
  if (col.primary && /serial/i.test(type)) return `"${col.name}" ${type} PRIMARY KEY`;

  const parts = [`"${col.name}"`, type];
  const def = defaultLiteral(col.default);
  if (def !== null) parts.push(`DEFAULT ${def}`);

  // On CREATE we can honour NOT NULL freely. On ALTER against a table that
  // already holds rows, NOT NULL without a default would fail — so add it
  // nullable rather than refusing to boot.
  if (col.notNull && (forCreate || def !== null)) parts.push("NOT NULL");
  if (col.primary && !/serial/i.test(type)) parts.push("PRIMARY KEY");
  return parts.join(" ");
}

export interface SchemaSyncReport {
  tablesCreated: string[];
  columnsAdded: string[];
  indexesCreated: string[];
}

/**
 * A fingerprint of the shape the code expects: every table, column, type and
 * index name. Stored after a successful sync, and compared on the next boot.
 *
 * This replaces the old "does one known column exist" sentinel, which had to
 * be updated by hand with every migration and silently skipped everything when
 * somebody forgot. A fingerprint cannot be forgotten: change the schema and it
 * changes with you.
 */
export function schemaFingerprint(): string {
  const parts: string[] = [];
  for (const value of Object.values(schema)) {
    let config: ReturnType<typeof getTableConfig>;
    try {
      config = getTableConfig(value as never);
    } catch {
      continue;
    }
    const cols = config.columns
      .map((c) => `${c.name}:${c.getSQLType()}:${c.notNull ? 1 : 0}`)
      .sort()
      .join(",");
    const idx = config.indexes
      .map((i) => (i as unknown as { config: { name: string } }).config?.name ?? "")
      .sort()
      .join(",");
    parts.push(`${config.name}(${cols})[${idx}]`);
  }
  parts.sort();
  // Bootstrap steps that aren't visible in the table shapes still need to run
  // once on every database. Bump this when one is added.
  parts.push("bootstrap:sequences-v1");
  parts.push("bootstrap:crm-tables-v4");
  parts.push("bootstrap:studio-v2");
  parts.push("bootstrap:broadcasts-v2");
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}

export async function ensureSchema(sql: Sql): Promise<SchemaSyncReport> {
  const report: SchemaSyncReport = { tablesCreated: [], columnsAdded: [], indexesCreated: [] };

  for (const value of Object.values(schema)) {
    let config: ReturnType<typeof getTableConfig>;
    try {
      config = getTableConfig(value as never);
    } catch {
      continue; // not a table — an enum, a zod schema, a helper
    }

    const cols = config.columns.map((c) => columnDdl(c, true)).join(", ");
    await sql.unsafe(`CREATE TABLE IF NOT EXISTS "${config.name}" (${cols})`);
    report.tablesCreated.push(config.name);

    // Covers a table that already exists but predates a column.
    for (const col of config.columns) {
      if (col.primary && /serial/i.test(col.getSQLType())) continue;
      await sql.unsafe(`ALTER TABLE "${config.name}" ADD COLUMN IF NOT EXISTS ${columnDdl(col, false)}`);
      report.columnsAdded.push(`${config.name}.${col.name}`);
    }

    // A column-level .unique() produces a constraint, not an entry in
    // config.indexes. Without it, every ON CONFLICT (email) in the codebase
    // fails with "no unique or exclusion constraint matching".
    for (const col of config.columns) {
      const c = col as unknown as { isUnique?: boolean; uniqueName?: string; name: string };
      if (!c.isUnique) continue;
      const name = c.uniqueName || `${config.name}_${c.name}_unique`;
      await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "${name}" ON "${config.name}" ("${c.name}")`);
      report.indexesCreated.push(name);
    }

    for (const index of config.indexes) {
      const cfg = (index as unknown as { config: { name: string; unique: boolean; columns: { name: string }[] } }).config;
      if (!cfg?.name || !cfg.columns?.length) continue;
      const target = cfg.columns.map((c) => `"${c.name}"`).join(", ");
      await sql.unsafe(
        `CREATE ${cfg.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS "${cfg.name}" ON "${config.name}" (${target})`,
      );
      report.indexesCreated.push(cfg.name);
    }

    for (const uq of config.uniqueConstraints ?? []) {
      const cfg = uq as unknown as { name?: string; columns?: { name: string }[] };
      if (!cfg.name || !cfg.columns?.length) continue;
      const target = cfg.columns.map((c) => `"${c.name}"`).join(", ");
      await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "${cfg.name}" ON "${config.name}" (${target})`);
      report.indexesCreated.push(cfg.name);
    }
  }

  await realignSequences(sql);
  return report;
}

/**
 * A row inserted with an explicit id (a seed, a restore, a hand fix) does not
 * advance the serial's sequence, so the next plain insert tries to reuse that
 * id and fails on the primary key — which is exactly what "the first save
 * failed, the second worked" looks like. Push every id sequence past the
 * largest id its table already holds. Only ever moves forward.
 */
async function realignSequences(sql: Sql): Promise<void> {
  for (const value of Object.values(schema)) {
    let config: ReturnType<typeof getTableConfig>;
    try {
      config = getTableConfig(value as never);
    } catch {
      continue;
    }
    const id = config.columns.find((c) => c.primary && /serial/i.test(c.getSQLType()));
    if (!id) continue;
    try {
      const rows = (await sql.unsafe(
        `SELECT pg_get_serial_sequence('"${config.name}"', '${id.name}') AS seq, COALESCE(MAX("${id.name}"), 0)::bigint AS max FROM "${config.name}"`,
      )) as { seq: string | null; max: string | number }[];
      const seq = rows?.[0]?.seq;
      const max = Number(rows?.[0]?.max ?? 0);
      if (!seq || max <= 0) continue;
      const cur = (await sql.unsafe(`SELECT last_value, is_called FROM ${seq}`)) as { last_value: string | number; is_called: boolean }[];
      const last = Number(cur?.[0]?.last_value ?? 0);
      const next = cur?.[0]?.is_called ? last + 1 : last;
      if (next > max) continue;
      await sql.unsafe(`SELECT setval('${seq}', ${max}, true)`);
    } catch (err) {
      console.warn(`Couldn't realign the id sequence for ${config.name}:`, (err as Error).message);
    }
  }
}
