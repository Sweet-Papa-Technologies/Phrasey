/**
 * Consent state as a store, so the banner, the Manage panel, and the footer
 * trigger all read one source of truth (design doc §8).
 */
import { create } from 'zustand';
import {
  type ConsentState,
  gpcEnabled,
  makeDecision,
  resolveInitialConsent,
  writeConsent,
} from '../compliance/consent';
import { applyAnalyticsConsent, installConsentDefaults } from '../compliance/analytics';

interface ConsentStore {
  state: ConsentState | null;
  /** The banner is showing. */
  prompting: boolean;
  /** The Manage panel is open (from the banner or from the footer). */
  managing: boolean;
  gpc: boolean;
  initialized: boolean;

  init: () => void;
  acceptAll: () => void;
  rejectAll: () => void;
  saveChoices: (analytics: boolean) => void;
  openManager: () => void;
  closeManager: () => void;
}

export const useConsentStore = create<ConsentStore>((set, get) => ({
  state: null,
  prompting: false,
  managing: false,
  gpc: false,
  initialized: false,

  init: () => {
    if (get().initialized) return;
    // Consent Mode defaults must be installed before anything could load GA4.
    installConsentDefaults();
    const { state, shouldPrompt } = resolveInitialConsent(Date.now());
    applyAnalyticsConsent(state?.analytics === true);
    set({ state, prompting: shouldPrompt, gpc: gpcEnabled(), initialized: true });
  },

  acceptAll: () => {
    const state = makeDecision('accept-all', true, Date.now());
    writeConsent(state);
    applyAnalyticsConsent(state.analytics);
    set({ state, prompting: false, managing: false });
  },

  rejectAll: () => {
    const state = makeDecision('reject-all', false, Date.now());
    writeConsent(state);
    applyAnalyticsConsent(false);
    set({ state, prompting: false, managing: false });
  },

  saveChoices: (analytics: boolean) => {
    const state = makeDecision('manage', analytics, Date.now());
    writeConsent(state);
    applyAnalyticsConsent(state.analytics);
    set({ state, prompting: false, managing: false });
  },

  openManager: () => set({ managing: true }),
  closeManager: () => set((s) => ({ managing: false, prompting: s.state === null })),
}));
