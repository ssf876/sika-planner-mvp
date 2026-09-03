# Sika Planner

Zero-based budgeting that answers one question instantly: how much do I actually
have left, right now, in every category — including what I put on a credit card
or pulled from an ATM.

Desktop-first web app: Next.js (App Router) + TypeScript strict + SQLite via
Prisma, with Vitest unit tests and Playwright wired for e2e.

## Getting started

```bash
pnpm install
cp .env.example .env   # SQLite file location for local dev
pnpm db:migrate        # apply Prisma migrations
pnpm dev               # http://localhost:3000
```

## Commands

| Command           | What it does                        |
| ----------------- | ----------------------------------- |
| `pnpm lint`       | ESLint (flat config)                |
| `pnpm typecheck`  | `tsc --noEmit`                      |
| `pnpm test`       | Vitest unit tests                   |
| `pnpm test:e2e`   | Playwright (needs `pnpm dev` or CI) |
| `pnpm build`      | Production build                    |
| `pnpm format`     | Prettier write                      |
| `pnpm db:migrate` | `prisma migrate dev` (local)        |
| `pnpm db:deploy`  | `prisma migrate deploy` (CI-like)   |

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, migrations,
and the production build on every PR.

## Conventions

- **Money is Int cents everywhere** — never floats. See `lib/money.ts`.
- Package manager is **pnpm** (pinned via `packageManager`).
- Full product spec lives in the Obvious project ("Sika Planner — v1 Product &
  Technical Spec").
