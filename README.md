# Phrasey

A word-guessing party game where you can only guess letters you're holding.
Wheel of Fortune's board, Uno's hand, and a soda bottle that gets shaken harder
every time somebody's wrong.

Full requirements and design: [`Phrasey-design-doc.md`](./Phrasey-design-doc.md).

## Layout

```
packages/
  shared/      types, socket protocol, balance constants   (the contract)
  engine/      pure TS rules engine — no I/O, seeded RNG
  server/      Fastify + Socket.IO, room lifecycle, bot driver
  client/      React 19 SPA
  corpus-gen/  offline puzzle generation CLI
infra/         Terraform (GCP project: fofoapps-934be)
```

## Quick start

```bash
pnpm install
pnpm build
pnpm test
pnpm dev            # server on :8080, client on :5173
```

## Non-negotiables

- **The puzzle string never leaves the server.** Clients receive `MaskedBoard`
  only. See `maskBoard()` and its adversarial tests.
- **No LLM at runtime.** The only model call in the system is offline, in
  `packages/corpus-gen`, producing reviewed artifacts.
- **No accounts, no PII.** Display names are session-scoped and discarded.
