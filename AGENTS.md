# Repository Guidelines

## Project Structure & Module Organization

The active application is a Preact, Vite, and TypeScript project at the repository root. Core
calculation and data-model code lives in `src/*.ts`; UI components and their adjacent CSS live under
`src/components/`. Generated application data and icon sprites are in `src/assets/`. Vitest suites
mirror features in `test/`, with script-specific tests in `test/scripts/`. Data ingestion and
analysis utilities belong in `scripts/`. Treat `ballet0/` and `guava0/` as archived experiments
retained for reference and scripts, not as the current app.

Read `FACTORIO.md`, `UI.md`, and `CELL.md` before changing domain or interface behavior. For
ingestion changes, read `INGEST.md` first.

For heavier tasks, read `CONTEXT.md` for additional architecture, data-model, solver, ingestion, and
repository-history context.

## Build, Test, and Development Commands

- `npm run dev` starts Vite locally (normally at `http://localhost:5173/`).
- `npm run build` runs the TypeScript project build and creates the production bundle in `dist/`.
- `npm test` runs all Vitest tests once.
- `npx vitest run test/flow.test.ts` runs one test file; use `-t 'test name'` to filter cases.
- `npm run lint` runs ESLint and TypeScript checks.
- `npm run format` formats the repository with oxfmt.
- `npm run preview` serves the built application locally.

Use Node 24, assuming `node` is available on `PATH`.

## Coding Style & Naming Conventions

Write strict TypeScript and functional Preact components. Follow oxfmt output (two-space
indentation) rather than hand-aligning code. Use `camelCase` for functions and variables,
`PascalCase` for types and components, and kebab-case component filenames such as `search-box.tsx`.
Keep component CSS beside its TSX file and prefix global class names by component. Include explicit
`.ts` extensions in local imports. ESLint rejects unused values; prefix intentionally unused
parameters with `_`.

## Testing Guidelines

Tests use Vitest and must match `test/**/*.test.ts`. Name suites after the unit under test and write
behavior-focused `it(...)` descriptions. Add regression coverage for solver, packing, URL-state, or
ingestion changes. Run the focused test while developing, then `npm test` and `npm run lint` before
handing off.

## Commit & Pull Request Guidelines

History uses Conventional Commits: `feat: add belt choice`, `fix(ui): preserve selection`, or
`chore: refresh data`. Use a lowercase imperative subject without a trailing period; explain
non-obvious rationale in the body. This is a linear, single-author repository that normally commits
directly to `main`. If contributing through a pull request, keep it focused, describe behavior and
validation, link relevant issues, and include before/after images for visual changes.
