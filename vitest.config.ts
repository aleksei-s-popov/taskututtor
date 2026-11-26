import { defineConfig } from "vitest/config";

// Unit tests for the app's pure logic. The server has its own tests in server/.
export default defineConfig({ test: { include: ["tests/**/*.test.ts"] } });
