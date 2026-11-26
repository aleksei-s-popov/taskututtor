import { defineConfig } from "vitest/config";

// The API test starts a real local Worker, so give it time and run files one at a time.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], testTimeout: 60_000, hookTimeout: 120_000, fileParallelism: false } });
