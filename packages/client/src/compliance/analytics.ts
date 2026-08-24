/**
 * GA4 behind Google Consent Mode v2 (design doc §8, §11).
 *
 * Two rules govern everything in this file:
 *
 * 1. **Reject-all provably blocks GA4 network calls** (§14 M7 exit criterion).
 *    So the gtag.js script tag is not merely configured to be quiet — it is
 *    never inserted into the document at all until consent is granted. There
 *    is no code path from "denied" to a request to googletagmanager.com.
 *
 * 2. **Never log anything identifying** (§11): no puzzle text, no display
 *    names, no room codes. The event API below is deliberately narrow so it is
 *    hard to pass something you shouldn't — every parameter is an enum, a
 *    count, or a boolean.
 */
import { gpcEnabled } from './consent';

/** §11's list, verbatim. */
export type AnalyticsEvent =
  | { name: 'room_created'; params: { match_mode: 'rounds' | 'score'; bot_count: number } }
  | { name: 'room_joined'; params: { player_count: number } }
  | { name: 'game_started'; params: { player_count: number; bot_count: number; turn_seconds: number | 0 } }
  | { name: 'round_completed'; params: { reason: string; round_number: number; turns: number } }
  | { name: 'blowout'; params: { round_number: number } }
  | { name: 'solve_attempt'; params: { hidden_fraction: number } }
  | { name: 'solve_success'; params: { hidden_letters: number } }
  /** Type only — never which letter, and never the puzzle. */
  | { name: 'card_played'; params: { card_type: 'letter' | 'action'; action?: string } }
  | { name: 'match_completed'; params: { rounds_played: number; player_count: number } }
  | { name: 'player_dropped'; params: { became_bot: boolean } }
  // The counterpart to `player_dropped`: did the player actually get back in?
  // `same_seat` false means the reclaim window had passed and they were seated
  // fresh. No ids, no room code — just the outcome.
  | { name: 'reconnected'; params: { same_seat: boolean } }
  | { name: 'seat_lost'; params: { reason: string } };

const GTAG_SRC = 'https://www.googletagmanager.com/gtag/js';

/**
 * Read at call time rather than at module load, so a test can prove that
 * granting consent DOES inject the script. Without that, the reject-all test
 * would pass vacuously whenever no measurement id is configured — which is
 * exactly the situation in CI.
 */
function gaId(): string | undefined {
  return import.meta.env.VITE_GA4_MEASUREMENT_ID || undefined;
}

type GtagArgs = unknown[];
declare global {
  interface Window {
    dataLayer?: GtagArgs[];
    gtag?: (...args: GtagArgs) => void;
  }
}

let scriptInjected = false;
let granted = false;

function gtag(...args: GtagArgs): void {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push(args);
}

/**
 * Install Consent Mode v2 defaults. Safe and correct to call before any
 * consent decision exists, and it MUST run before gtag.js would ever load —
 * that ordering is the whole mechanism.
 *
 * §8: "all storage types defaulted to `denied`". Taken literally, including
 * `security_storage`; Phrasey serves no ads and needs none of them.
 */
export function installConsentDefaults(): void {
  if (typeof window === 'undefined') return;
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    functionality_storage: 'denied',
    personalization_storage: 'denied',
    security_storage: 'denied',
    wait_for_update: 500,
  });
}

/** True once gtag.js has actually been added to the page. Used by tests. */
export function isAnalyticsLoaded(): boolean {
  return scriptInjected;
}

export function isAnalyticsGranted(): boolean {
  return granted;
}

function injectGtag(): void {
  const id = gaId();
  if (scriptInjected || !id || typeof document === 'undefined') return;
  const s = document.createElement('script');
  s.async = true;
  s.src = `${GTAG_SRC}?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
  scriptInjected = true;

  gtag('js', new Date());
  gtag('config', id, {
    // No PII is collected, but this is belt-and-braces: it stops GA from
    // storing the full IP, and there is nothing in a URL here worth sending.
    anonymize_ip: true,
    send_page_view: true,
  });
}

/**
 * Apply a consent decision. Granting loads GA4 (once); denying updates the
 * consent signal and — critically — never triggers a load.
 *
 * A GPC signal hard-denies regardless of what is passed, so a bug in the UI
 * cannot turn analytics on for someone whose browser opted them out.
 */
export function applyAnalyticsConsent(analyticsAllowed: boolean): void {
  const allow = analyticsAllowed && !gpcEnabled();
  granted = allow;

  gtag('consent', 'update', {
    analytics_storage: allow ? 'granted' : 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    functionality_storage: allow ? 'granted' : 'denied',
    personalization_storage: 'denied',
    security_storage: allow ? 'granted' : 'denied',
  });

  if (allow) injectGtag();
}

/**
 * Record an event. A no-op unless analytics has been granted AND loaded, so
 * calling this from gameplay code is always safe and never needs a guard at
 * the call site.
 */
export function track(event: AnalyticsEvent): void {
  if (!granted || !scriptInjected) return;
  gtag('event', event.name, event.params as Record<string, unknown>);
}

/** Test seam. Not exported from the barrel. */
export function __resetAnalyticsForTest(): void {
  scriptInjected = false;
  granted = false;
  if (typeof window !== 'undefined') window.dataLayer = [];
}
