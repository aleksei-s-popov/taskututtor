// Product analytics and error reports (PostHog), for the subscription build only.
//
// Privacy rules this module enforces:
//  - It is active only in builds that have both a server and a PostHog key configured. The
//    open-source build never loads it and sends nothing anywhere.
//  - No autocapture, no session recording, no page text: only the named events below, with
//    numbers and categories as properties. Never story text, looked-up words or anything typed.
//  - Nothing is stored on the device (memory only), so there is no analytics cookie.
//  - Readers are identified by their account id, never by email.

import type { PostHog } from "posthog-js";

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || "https://eu.i.posthog.com";

export const analyticsOn = !!KEY && !!import.meta.env.VITE_API_URL;

type Props = Record<string, string | number | boolean | null | undefined>;

let client: PostHog | null = null;
/** Calls made before the library has loaded. */
const waiting: ((ph: PostHog) => void)[] = [];

function run(fn: (ph: PostHog) => void): void {
  if (!analyticsOn) return;
  if (client) fn(client);
  else if (waiting.length < 200) waiting.push(fn);
}

export async function initAnalytics(): Promise<void> {
  if (!analyticsOn || client) return;
  try {
    const { default: posthog } = await import("posthog-js");
    posthog.init(KEY!, {
      api_host: HOST,
      persistence: "memory",
      person_profiles: "identified_only",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_performance: false,
      capture_exceptions: false, // reported by hand below, without loading extra scripts
      disable_session_recording: true,
      disable_surveys: true,
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
      // PostHog ignores automated browsers; end-to-end tests set this to see their own events.
      opt_out_useragent_filter: import.meta.env.VITE_POSTHOG_COUNT_BOTS === "1",
    });
    client = posthog;
    for (const fn of waiting.splice(0)) fn(posthog);
  } catch {
    waiting.length = 0; // blocked or offline: the app works the same without analytics
  }
}

export function identify(accountId: string): void {
  run((ph) => ph.identify(accountId));
}

export function resetIdentity(): void {
  run((ph) => ph.reset());
}

export function track(event: string, props: Props = {}): void {
  run((ph) => ph.capture(event, props));
}

export function reportError(error: unknown, where: string): void {
  run((ph) => ph.captureException(error instanceof Error ? error : new Error(String(error)), { where }));
}

if (analyticsOn) {
  window.addEventListener("error", (e) => reportError(e.error ?? e.message, "window"));
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason, "promise"));
}
