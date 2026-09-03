# AGENTS.md — Sika Planner

Ground rules for any agent or human editing this repo.

## Stack

- Next.js (App Router) + TypeScript **strict** (`tsconfig.json` — do not loosen).
- SQLite via Prisma. Money is **Int cents everywhere** — never floats. Format
  for display only, via `lib/money.ts`.
- Package manager: **pnpm** (version pinned in `package.json#packageManager`).
  Node `>=20`.

## Commands

```bash
pnpm lint          # ESLint flat config (must pass before pushing)
pnpm typecheck     # tsc --noEmit
pnpm test          # Vitest unit tests
pnpm build         # production build
pnpm format        # Prettier write
pnpm db:migrate    # prisma migrate dev (local schema changes)
pnpm db:deploy     # prisma migrate deploy (apply committed migrations)
```

Run `pnpm lint && pnpm typecheck && pnpm test` locally before every push. CI
runs the same plus `pnpm build` and `pnpm db:deploy` on every PR.

## Rules

- Never hand-edit files under `prisma/migrations/` — change `prisma/schema.prisma`
  and generate migrations with `pnpm db:migrate -- --name=short_descriptive_name`.
- Never commit `.env` or `*.db` files; `.env.example` documents required vars.
- Unit tests live in `tests/` (Vitest, node environment); Playwright e2e specs
  live in `e2e/`.
- Branch from the release branch (`release/*`), not `main`; PRs target the
  release branch per the project's release strategy.
