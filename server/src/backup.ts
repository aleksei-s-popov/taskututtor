// Scheduled database export.
//
// D1 already offers point-in-time recovery for the recent past. This adds an independent copy:
// once a week the whole database is written as a gzipped SQL file to its own R2 bucket, so data
// can be restored after a mistake that is noticed late, or into a brand-new database.
//
// Restore:  wrangler r2 object get taskututtor-backups/<file> --file backup.sql.gz
//           gunzip backup.sql.gz && wrangler d1 execute taskututtor --remote --file backup.sql

import type { Env } from "./bindings";

const TABLES = ["profiles", "series", "chapters", "jobs", "reports"];
const PAGE = 200;

function literal(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** The whole database as SQL statements that recreate every row. */
export async function dumpSql(env: Env): Promise<{ sql: string; rows: number }> {
  const out: string[] = [`-- Taskututtor database export, ${new Date().toISOString()}`];
  let rows = 0;
  for (const table of TABLES) {
    for (let offset = 0; ; offset += PAGE) {
      const page = await env.DB.prepare(`SELECT * FROM ${table} ORDER BY rowid LIMIT ? OFFSET ?`).bind(PAGE, offset).all<Record<string, unknown>>();
      for (const row of page.results) {
        const cols = Object.keys(row);
        out.push(`INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => literal(row[c])).join(", ")});`);
      }
      rows += page.results.length;
      if (page.results.length < PAGE) break;
    }
  }
  return { sql: out.join("\n") + "\n", rows };
}

/** Writes one export to the backup bucket and removes the oldest ones beyond the keep count. */
export async function runBackup(env: Env): Promise<{ key: string; rows: number; bytes: number }> {
  const { sql, rows } = await dumpSql(env);
  const gz = new Uint8Array(await new Response(new Blob([sql]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
  const key = `db/${new Date().toISOString().replace(/[:.]/g, "-")}.sql.gz`;
  await env.BACKUPS.put(key, gz, { httpMetadata: { contentType: "application/gzip" } });

  const keep = Math.max(1, Number(env.BACKUP_KEEP) || 12);
  const all = (await env.BACKUPS.list({ prefix: "db/" })).objects.map((o) => o.key).sort();
  const old = all.slice(0, Math.max(0, all.length - keep));
  if (old.length) await env.BACKUPS.delete(old);
  return { key, rows, bytes: gz.length };
}
