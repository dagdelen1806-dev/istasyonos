# Repository Guidelines

## Project Structure & Module Organization

İstasyonOS manages fuel-station shifts, inventory, and operational finance. The stack is React 19, TypeScript, Vite, Express, and MySQL/mysql2.

- `client/src/`: application pages, components, hooks, and styles; `components/stationos/` contains business modules.
- `client/public/`: PWA manifest, service worker, icons, and offline assets.
- `server/_core/`: Express bootstrap and platform services; `server/local-auth.ts` implements local authentication.
- `server/stationos/`: operational REST API, domain rules, safety helpers, migrations, and colocated tests.
- `shared/`: client/server types and contract drafts.
- `drizzle/`: user schema and migrations; `scripts/`: setup and verification tools.
- `docs/`: historical designs, prototypes, and examples; these are not the current application.

## Build, Test, and Development Commands

Use Node.js 22 or 24 and pnpm 10.18.0 from the repository root.

- `pnpm install --frozen-lockfile`: install locked dependencies.
- `pnpm dev`: start Express with Vite development support.
- `pnpm check`: run strict TypeScript checking.
- `pnpm test`: run Vitest once.
- `pnpm build`: bundle the frontend and server into `dist/`.
- `pnpm start`: run the production build.
- `pnpm format`: format the repository with Prettier; review resulting changes.

Configure `.env` from `.env.example`. On an authorized development database, run `pnpm db:migrate`, then `pnpm tsx server/stationos/migrate.ts`. Add new migrations instead of editing applied ones.

## Coding Style & Naming Conventions

Use TypeScript with ESM imports. Prettier specifies two spaces, double quotes, semicolons, LF endings, and an 80-character target width. Follow nearby naming: PascalCase React components, camelCase functions, and `use`-prefixed hooks. Use `@/` and `@shared/` aliases where appropriate. Keep application-facing copy Turkish.

## Testing Guidelines

Vitest uses the Node environment and discovers `server/**/*.test.ts` and `server/**/*.spec.ts`. No coverage threshold is configured. Test changed business rules, tenant isolation, authorization, and financial edge cases. Run `pnpm check`, `pnpm test`, and `pnpm build` before review. Database smoke and rollback checks require a separate test database; smoke tests create DEMO records.

## Commit & Pull Request Guidelines

Git history is unavailable in this checkout. Use concise imperative commit subjects, optionally scoped, such as `fix(auth): reject expired sessions`. PRs should describe behavior changes, link relevant issues, list validation results, and include screenshots for UI changes. Explain migration effects and configuration changes.

## Security & Domain Rules

Never commit `.env`, credentials, session tokens, or private financial data. Preserve integer-kuruş money calculations, transaction boundaries, idempotency, tenant checks, and independent approval rules. Treat running code and current tests as authoritative over historical plans; do not present planned integrations as working features.
