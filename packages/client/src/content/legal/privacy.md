# Privacy Policy

**Last updated:** 2026-08-23
**Applies to:** phrasey.web.app and the Phrasey game service

> **Draft — pending human review.** Design doc §8: "Have a human review the final
> copy before public launch." This copy follows conventional industry wording on
> purpose; it is not legal advice.

## The short version

Phrasey has no accounts. We do not ask for your name, your email, or your phone
number, and we do not have a way to identify you across sessions. The display
name you pick when you join a room lives in memory for the length of that game
and is then thrown away.

## What we collect

**Gameplay data (required for the game to work).** When you join a room we hold,
in server memory for the duration of the session: your chosen display name, your
avatar color, your seat in the room, your hand of cards, and your score. A room
record is written to our database with a room code and timestamps, and is deleted
automatically after six hours.

**Analytics (only with your consent).** If you accept analytics cookies, we load
Google Analytics 4, which sets cookies and collects standard measurement data
including approximate location derived from IP address, device and browser type,
and the pages and in-game events you trigger. We log **event types only** — never
puzzle text, never display names, never anything that identifies a player.

If you reject, GA4 is never loaded and no analytics cookies are set.

**What we never collect.** Accounts, email addresses, phone numbers, payment
details, precise location, contacts, or any special-category data. We do not sell
or share personal information, and we do not use your data for targeted
advertising or to train models.

## Cookies and local storage

| Purpose | Set when | What it is |
|---|---|---|
| Consent preference | Always | `localStorage`, records your choice and the policy version so a policy change re-prompts you |
| Session/reconnect token | On joining a room | `localStorage`, lets you reclaim your seat if you disconnect |
| Sound and display settings | On change | `localStorage`, your mute state and volume |
| Google Analytics | Only after you accept analytics | First-party cookies set by GA4 |

Full detail is on the [Cookies](/cookies) page.

## Your choices

- **Consent banner.** On first load you can Accept all, Reject all, or Manage
  individual purposes. Rejecting is exactly as easy as accepting.
- **Change your mind.** The **Your Privacy Choices** link in the footer reopens
  the consent manager at any time.
- **Global Privacy Control.** If your browser sends a GPC signal, we treat that
  as an opt-out of analytics automatically — you do not need to do anything else.
- **Clear everything.** Clearing site data for phrasey.web.app removes all local
  storage and cookies we have set.

Depending on where you live you may have rights to access, correct, delete, or
port personal information, and to opt out of sale/sharing and targeted
advertising. We do not sell or share personal information. Because we operate no
accounts, we generally hold no personal information tied to you that we could
retrieve; requests can still be sent to the contact address below.

## Retention

Room records are deleted automatically six hours after creation. In-memory game
state is discarded when the room ends. Completed match summaries retain scores
and puzzle ids only — no names. Analytics data is retained per Google Analytics'
configured retention window.

## Children

Phrasey is intended for users aged 13 and over. We do not knowingly collect
personal information from children under 13. If you believe a child has provided
us information, contact us and we will delete it.

## Service providers

- **Google Cloud Platform** — hosting, database, and content delivery
- **Google Analytics 4** — measurement, loaded only with consent

## Changes

If this policy changes materially we increment the policy version, which causes
the consent banner to re-prompt you.

## Contact

privacy@sweetpapatechnologies.com — Sweet Papa Technologies
