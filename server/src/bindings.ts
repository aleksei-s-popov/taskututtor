// Minimal shapes of the Cloudflare bindings this Worker uses. Declared by hand (instead of
// @cloudflare/workers-types) so the shared app code, which is typed against the DOM, can be
// type-checked together with the server.

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface D1 {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown>;
}

export interface R2Object {
  body: ReadableStream;
  arrayBuffer(): Promise<ArrayBuffer>;
  httpMetadata?: { contentType?: string };
}

export interface R2 {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<R2Object | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: { prefix?: string }): Promise<{ objects: { key: string }[] }>;
}

export interface JobQueue {
  send(message: { jobId: string }): Promise<void>;
}

export interface QueueBatch {
  messages: { body: { jobId: string }; ack(): void }[];
}

export interface Env {
  DB: D1;
  IMAGES: R2;
  /** Separate bucket for database exports, so they survive anything that happens to the live data. */
  BACKUPS: R2;
  JOBS: JobQueue;
  OPENROUTER_API_KEY: string;
  CLERK_JWT_KEY?: string;
  STORY_MODEL: string;
  LOOKUP_MODEL: string;
  GLOSSARY_MODEL: string;
  IMAGE_MODEL: string;
  DAILY_CHAPTER_LIMIT: string;
  ALLOWED_ORIGINS: string;
  /** How many weekly database exports to keep. */
  BACKUP_KEEP?: string;
  /** Local development only: accept "Bearer dev:<user id>" instead of a Clerk token. */
  DEV_AUTH?: string;
  /** Override for tests; defaults to https://openrouter.ai/api/v1 */
  OPENROUTER_BASE?: string;
}
