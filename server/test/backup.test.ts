import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { dumpSql, runBackup } from "../src/backup";
import type { Env } from "../src/bindings";

/** In-memory stand-ins for the database and the backup bucket. */
function fakeEnv(tables: Record<string, Record<string, unknown>[]>, keep = "2") {
  const bucket = new Map<string, Uint8Array>();
  const env = {
    BACKUP_KEEP: keep,
    DB: {
      prepare(sql: string) {
        const table = /FROM (\w+)/.exec(sql)![1];
        let args: unknown[] = [];
        const stmt = {
          bind: (...a: unknown[]) => ((args = a), stmt),
          all: async () => ({ results: (tables[table] ?? []).slice(args[1] as number, (args[1] as number) + (args[0] as number)) }),
        };
        return stmt;
      },
    },
    BACKUPS: {
      put: async (key: string, value: Uint8Array) => void bucket.set(key, value),
      list: async () => ({ objects: [...bucket.keys()].map((key) => ({ key })) }),
      delete: async (keys: string | string[]) => void [keys].flat().forEach((k) => bucket.delete(k)),
    },
  } as unknown as Env;
  return { env, bucket };
}

describe("database export", () => {
  it("writes every row as a restorable SQL statement", async () => {
    const { env } = fakeEnv({
      profiles: [{ user_id: "u1", data: '{"lang":"English"}', updated_at: 5 }],
      chapters: [{ id: "c1", series_id: "s1", user_id: "u1", idx: 0, data: `{"title":"It's here"}`, created_at: 1, updated_at: null }],
    });
    const { sql, rows } = await dumpSql(env);
    expect(rows).toBe(2);
    expect(sql).toContain(`INSERT OR REPLACE INTO profiles (user_id, data, updated_at) VALUES ('u1', '{"lang":"English"}', 5);`);
    // Quotes are escaped and missing values become NULL, so the file runs as-is.
    expect(sql).toContain(`'{"title":"It''s here"}', 1, NULL);`);
  });

  it("pages through tables larger than one query", async () => {
    const many = Array.from({ length: 450 }, (_, i) => ({ id: `c${i}` }));
    expect((await dumpSql(fakeEnv({ chapters: many }).env)).rows).toBe(450);
  });

  it("stores a gzipped file and keeps only the newest exports", async () => {
    const { env, bucket } = fakeEnv({ profiles: [{ user_id: "u1", data: "{}", updated_at: 1 }] }, "2");
    bucket.set("db/2020-01-01.sql.gz", new Uint8Array());
    bucket.set("db/2020-01-08.sql.gz", new Uint8Array());
    const done = await runBackup(env);
    expect(done.rows).toBe(1);
    expect([...bucket.keys()].sort()).toEqual(["db/2020-01-08.sql.gz", done.key].sort());
    expect(gunzipSync(bucket.get(done.key)!).toString()).toContain("INSERT OR REPLACE INTO profiles");
  });
});
