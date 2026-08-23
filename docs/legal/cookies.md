# Cookie Policy

**Last updated:** 2026-08-23

> **Draft — pending human review** (design doc §8).

Phrasey uses a small number of cookies and browser storage entries. Everything
outside the "Strictly necessary" table below is off until you turn it on.

## Strictly necessary

These make the game function and cannot be switched off. They store no
personal information and are not used for tracking.

| Name | Type | Lifetime | Purpose |
|---|---|---|---|
| `phrasey.consent` | localStorage | Until cleared | Your consent choices and the policy version they were given against |
| `phrasey.session` | localStorage | Until cleared | Reconnect token so you can reclaim your seat after a disconnect |
| `phrasey.prefs` | localStorage | Until cleared | Mute state, volume, cast-view and reduced-motion preferences |

## Analytics — off by default

Loaded only if you accept analytics in the consent banner, and never loaded at
all if your browser sends a Global Privacy Control signal.

| Name | Type | Lifetime | Purpose |
|---|---|---|---|
| `_ga` | Cookie | 2 years | Google Analytics — distinguishes browsers |
| `_ga_<container>` | Cookie | 2 years | Google Analytics — session state |

We use Google Consent Mode v2 with every storage type defaulted to `denied`.
Until you accept, the GA4 script is not requested and no network call is made to
Google's measurement endpoints.

We record event **types** — a card was played, a round completed, a gauge blew.
We never record puzzle text, display names, or anything that identifies a player.

## Advertising

None. Phrasey serves no ads and sets no advertising cookies.

## Managing your choices

- The **Your Privacy Choices** link in the footer reopens the consent manager.
- Rejecting is one click, exactly like accepting.
- Your browser's settings can block or clear cookies for this site at any time.
