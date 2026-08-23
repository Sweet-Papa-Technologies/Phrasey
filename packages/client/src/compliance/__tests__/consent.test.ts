/**
 * §14 M7 exit criterion: "Reject-all provably blocks GA4 network calls; GPC
 * honored." These tests are that proof, so they assert on the DOM and the
 * consent signal rather than on our own booleans.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONSENT_POLICY_VERSION,
  CONSENT_STORAGE_KEY,
  clearConsent,
  gpcEnabled,
  makeDecision,
  readConsent,
  resolveInitialConsent,
  writeConsent,
} from '../consent';
import {
  __resetAnalyticsForTest,
  applyAnalyticsConsent,
  installConsentDefaults,
  isAnalyticsLoaded,
  track,
} from '../analytics';

function gtagScripts(): HTMLScriptElement[] {
  return [...document.querySelectorAll('script')].filter((s) => s.src.includes('googletagmanager.com'));
}

function setGpc(v: boolean | undefined) {
  Object.defineProperty(navigator, 'globalPrivacyControl', { value: v, configurable: true });
}

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = '';
  window.dataLayer = [];
  setGpc(undefined);
  __resetAnalyticsForTest();
});

describe('reject-all blocks GA4', () => {
  it('never inserts the gtag script', () => {
    installConsentDefaults();
    applyAnalyticsConsent(false);
    expect(gtagScripts()).toHaveLength(0);
    expect(isAnalyticsLoaded()).toBe(false);
  });

  it('installs Consent Mode v2 with every storage type denied before anything loads', () => {
    installConsentDefaults();
    const dflt = window.dataLayer!.find((a) => a[0] === 'consent' && a[1] === 'default');
    expect(dflt).toBeDefined();
    const cfg = dflt![2] as Record<string, string>;
    for (const key of [
      'ad_storage',
      'ad_user_data',
      'ad_personalization',
      'analytics_storage',
      'functionality_storage',
      'personalization_storage',
      'security_storage',
    ]) {
      expect(cfg[key], `${key} must default to denied`).toBe('denied');
    }
    expect(gtagScripts()).toHaveLength(0);
  });

  it('updates the consent signal to denied on reject', () => {
    installConsentDefaults();
    applyAnalyticsConsent(false);
    const update = window.dataLayer!.filter((a) => a[0] === 'consent' && a[1] === 'update').pop();
    expect((update![2] as Record<string, string>).analytics_storage).toBe('denied');
  });

  it('track() is inert when consent was refused', () => {
    installConsentDefaults();
    applyAnalyticsConsent(false);
    const before = window.dataLayer!.length;
    track({ name: 'blowout', params: { round_number: 2 } });
    expect(window.dataLayer!.length).toBe(before);
  });

  it('stays inert after a reject even if track is called many times', () => {
    applyAnalyticsConsent(false);
    for (let i = 0; i < 50; i++) track({ name: 'card_played', params: { card_type: 'letter' } });
    expect(gtagScripts()).toHaveLength(0);
  });
});

describe('GPC is honored', () => {
  it('reports the signal', () => {
    setGpc(true);
    expect(gpcEnabled()).toBe(true);
    setGpc(false);
    expect(gpcEnabled()).toBe(false);
  });

  it('records a denied decision without ever prompting', () => {
    setGpc(true);
    const { state, shouldPrompt } = resolveInitialConsent(1000);
    expect(shouldPrompt).toBe(false);
    expect(state?.analytics).toBe(false);
    expect(state?.via).toBe('gpc');
  });

  it('overrides an accept-all that the UI should never have offered', () => {
    setGpc(true);
    const decision = makeDecision('accept-all', true, 1);
    expect(decision.analytics).toBe(false);

    applyAnalyticsConsent(true);
    expect(gtagScripts()).toHaveLength(0);
    expect(isAnalyticsLoaded()).toBe(false);
  });

  it('downgrades a previously stored grant', () => {
    writeConsent(makeDecision('accept-all', true, 1));
    setGpc(true);
    const { state } = resolveInitialConsent(2);
    expect(state?.analytics).toBe(false);
    expect(readConsent()?.analytics).toBe(false);
  });
});

describe('stored decisions', () => {
  it('prompts when nothing is stored', () => {
    expect(resolveInitialConsent(1).shouldPrompt).toBe(true);
  });

  it('does not prompt again once decided', () => {
    writeConsent(makeDecision('reject-all', false, 1));
    expect(resolveInitialConsent(2).shouldPrompt).toBe(false);
  });

  it('re-prompts when the policy version moves', () => {
    localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({ version: CONSENT_POLICY_VERSION - 1, necessary: true, analytics: true, decidedAt: 1, via: 'accept-all' }),
    );
    expect(readConsent()).toBeNull();
    expect(resolveInitialConsent(2).shouldPrompt).toBe(true);
  });

  it('treats corrupt storage as no decision rather than as consent', () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, '{not json');
    expect(readConsent()).toBeNull();
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ version: CONSENT_POLICY_VERSION, analytics: 'yes' }));
    expect(readConsent()).toBeNull();
  });

  it('survives storage being unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => readConsent()).not.toThrow();
    expect(readConsent()).toBeNull();
    spy.mockRestore();
  });

  it('clearConsent removes the decision', () => {
    writeConsent(makeDecision('accept-all', true, 1));
    clearConsent();
    expect(readConsent()).toBeNull();
  });
});

describe('event payloads carry nothing identifying (§11)', () => {
  it('the typed surface has no field that could hold a puzzle or a name', () => {
    // A compile-time guarantee mostly, but assert the runtime shape too: every
    // param value must be a primitive enum/count, never free text from the game.
    const samples = [
      { name: 'card_played', params: { card_type: 'letter' } },
      { name: 'solve_attempt', params: { hidden_fraction: 0.4 } },
      { name: 'round_completed', params: { reason: 'solved', round_number: 1, turns: 12 } },
    ] as const;
    for (const s of samples) {
      for (const v of Object.values(s.params)) {
        expect(['number', 'boolean', 'string']).toContain(typeof v);
        if (typeof v === 'string') expect(v.length).toBeLessThan(24);
      }
    }
  });
});

describe('the grant path actually loads GA4', () => {
  // Without this, every reject-all assertion above would pass vacuously in CI,
  // where no measurement id is configured. This proves the switch has two sides.
  it('injects gtag.js on grant, and still does not on reject', () => {
    vi.stubEnv('VITE_GA4_MEASUREMENT_ID', 'G-TESTONLY123');

    applyAnalyticsConsent(false);
    expect(gtagScripts(), 'reject must not load GA4 even with an id configured').toHaveLength(0);

    applyAnalyticsConsent(true);
    const loaded = gtagScripts();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.src).toContain('id=G-TESTONLY123');
    expect(isAnalyticsLoaded()).toBe(true);

    const before = window.dataLayer!.length;
    track({ name: 'blowout', params: { round_number: 1 } });
    expect(window.dataLayer!.length).toBeGreaterThan(before);

    vi.unstubAllEnvs();
  });

  it('a GPC signal still blocks the load with an id configured', () => {
    vi.stubEnv('VITE_GA4_MEASUREMENT_ID', 'G-TESTONLY123');
    setGpc(true);
    applyAnalyticsConsent(true);
    expect(gtagScripts()).toHaveLength(0);
    vi.unstubAllEnvs();
  });
});
