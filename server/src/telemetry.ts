// Server-side analytics (PostHog): what was generated, what it cost, and what failed.
//
// Only numbers and categories are sent: model names, token counts, cost, timings, error
// messages. Never story text, prompts, glossaries or anything a reader typed. Readers are
// identified by their account id. Everything here is best-effort and must never break a request.

import type { Env } from "./bindings";

type Props = Record<string, string | number | boolean | null | undefined>;

export function capture(env: Env, user: string, event: string, properties: Props = {}): void {
  if (!env.POSTHOG_KEY) return;
  const send = fetch(`${(env.POSTHOG_HOST || "https://eu.i.posthog.com").replace(/\/+$/, "")}/i/v0/e/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: env.POSTHOG_KEY,
      event,
      distinct_id: user,
      timestamp: new Date().toISOString(),
      properties: { ...properties, source: "server" },
    }),
  }).catch(() => undefined);
  env.wait?.(send);
}

/** One AI call, in the shape PostHog's LLM analytics reads (cost and latency per reader and model). */
export function captureGeneration(
  env: Env,
  user: string,
  kind: string,
  model: string,
  started: number,
  result: { usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }; status: number; error?: string },
): void {
  capture(env, user, "$ai_generation", {
    $ai_trace_id: crypto.randomUUID(),
    $ai_span_name: kind,
    $ai_provider: "openrouter",
    $ai_model: model,
    $ai_latency: Math.round((Date.now() - started) / 100) / 10,
    $ai_http_status: result.status,
    $ai_input_tokens: result.usage?.prompt_tokens,
    $ai_output_tokens: result.usage?.completion_tokens,
    $ai_total_cost_usd: result.usage?.cost,
    $ai_is_error: !!result.error,
    $ai_error: result.error?.slice(0, 200),
    kind,
  });
}
