/**
 * Consent state (design doc §8).
 *
 * The whole posture here is that not collecting anything is the biggest
 * compliance win available, and it costs the product nothing. So: two
 * categories, one of which is off until someone actively turns it on.
 *
 * Nothing in this module loads a third-party script. `analytics.ts` does that,
 * and only ever when asked by the state this module owns.
 */

export const CONSENT_STORAGE_KEY = 'phrasey.consent';

/**
 * Bump when the policy text changes materially. A stored decision against an
 * older version is treated as absent, which re-prompts — that is the point
 * (§8: "versioned so a policy change re-prompts").
 */
export const CONSENT_POLICY_VERSION = 1;

export interface ConsentState {
  version: number;
  /** Always true. Listed so the Manage panel can show it as locked-on. */
  necessary: true;
  analytics: boolean;
  /** Epoch ms the decision was recorded. */
  decidedAt: number;
  /** How the decision was reached — 'gpc' means we never asked. */
  via: 'accept-all' | 'reject-all' | 'manage' | 'gpc';
}

export type ConsentDecision = Pick<ConsentState, 'analytics'>;

/**
 * §8: "Honor Global Privacy Control — check `navigator.globalPrivacyControl`
 * and default analytics to denied when true."
 *
 * We go slightly further than defaulting: a GPC signal is a legally recognized
 * opt-out, so it *pins* analytics off rather than merely preselecting it. The
 * Manage panel says so instead of silently ignoring a toggle.
 */
export function gpcEnabled(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

function safeParse(raw: string | null): ConsentState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ConsentState>;
    if (typeof v !== 'object' || v === null) return null;
    if (v.version !== CONSENT_POLICY_VERSION) return null; // stale policy ⇒ re-prompt
    if (typeof v.analytics !== 'boolean') return null;
    return {
      version: CONSENT_POLICY_VERSION,
      necessary: true,
      analytics: v.analytics,
      decidedAt: typeof v.decidedAt === 'number' ? v.decidedAt : 0,
      via: v.via ?? 'manage',
    };
  } catch {
    return null;
  }
}

/** The stored decision, or null if we have never validly asked. */
export function readConsent(): ConsentState | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return safeParse(localStorage.getItem(CONSENT_STORAGE_KEY));
  } catch {
    // Private mode / storage disabled. No stored decision means we ask again,
    // which is the conservative direction.
    return null;
  }
}

export function writeConsent(state: ConsentState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage disabled — the session still honors the in-memory decision */
  }
}

export function clearConsent(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(CONSENT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function makeDecision(via: ConsentState['via'], analytics: boolean, nowMs: number): ConsentState {
  return {
    version: CONSENT_POLICY_VERSION,
    necessary: true,
    // A GPC signal overrides an "accept" that the UI should never have offered.
    analytics: gpcEnabled() ? false : analytics,
    decidedAt: nowMs,
    via,
  };
}

/**
 * The effective state at boot. Under GPC we record a decision without ever
 * showing the banner: asking someone to opt out again after their browser
 * already said no is exactly the dark pattern §8 is guarding against.
 */
export function resolveInitialConsent(nowMs: number): { state: ConsentState | null; shouldPrompt: boolean } {
  if (gpcEnabled()) {
    const stored = readConsent();
    const state = stored?.via === 'gpc' ? stored : makeDecision('gpc', false, nowMs);
    if (!stored || stored.analytics) writeConsent(state);
    return { state, shouldPrompt: false };
  }
  const stored = readConsent();
  return { state: stored, shouldPrompt: stored === null };
}
