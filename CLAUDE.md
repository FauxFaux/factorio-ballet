# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

## What this repo is

General-purpose Factorio production-chain calculator utilities. The live app (npm name `faucalc`) is
at the repo root: Preact + Vite + TypeScript, aiming at a useful suite of solvers. It is a
deliberate hybrid of two prior projects (see "Sibling repos" below), and the repo also contains two
earlier abandoned attempts (`ballet0/`, `guava0/`) kept only for their scripts.

## Commands

Node is managed with `fnm`. If `node` is not on PATH: `eval "$(fnm env)" && fnm use 24`.

```bash
npm run dev       # vite dev server — assume one is ALREADY running at http://localhost:5173/ showing the user changes live
npm run build     # tsc -b && vite build
npm run lint      # eslint . && tsc
npm run format    # oxfmt
npm test          # vitest run

npx vitest run test/scripts/locale.test.ts   # single test file
npx vitest run -t 'resolves a recipe-name key'   # by test name
```

Before committing, always run `npm run lint` and `npm run format`. Do not commit if lint fails.

### Data regeneration

`scripts/ingest-data.ts` converts a Factorio `data-raw-dump.json` + `*-locale.json` files (from the
game's `script-output/` directory) into `static.json`:

```bash
APP=<factorio-user-dir> node scripts/ingest-data.ts   # reads $APP/script-output/, writes ./static.json
```

The result is checked in as `src/assets/static.json`. Zod validators for the raw game data live in
`scripts/raw-validators.ts` (typed against the `factorio-raw-types` package); locale resolution
(including `["", ...]` concatenation and `entity-name.` fallback chains) is `scripts/locale.ts`,
tested in `test/scripts/locale.test.ts`.

## Read the design docs first

The repo carries substantial design documentation; it is the source of truth for intent and is kept
current:

- `FACTORIO.md` — the problem domain in one page (recipes, rates, and the three complications:
  cycles, productivity, catalysts).
- `UI.md` — analysis of the two prior planner UIs (supply-first manifest vs demand-first
  requirements) and the hybrid design this app is building toward.
- `docs/string.wiki` — copy of the Factorio wiki page on the locale/localisation file format.

## Architecture

### App shell (`src/`)

`main.tsx` → `UrlHandler` → `CrashHandler` → `App`. All UI state lives in `UrlState` and is packed
into the URL hash (`url-handler.tsx`): JSON with sorted keys → deflate (with a dictionary derived
from the default state, duplicated in-file "for stability reasons") → base64url, prefixed with a
version letter (`HASH_VERSION = 'g'`). Bumping state shape means handling the version prefix. State
flows down as `State<T> = [value, setter]` tuples (`ts.ts`).

### Data model (`src/types.ts`, `src/data.ts`)

`StaticData = { recipes, resources }`. Resources are keyed by `ResourceId` — the colon scheme
`item:<name>` | `fluid:<name>` shared with both prior projects. `Recipe.products` carry
`probability` and `{fixed}|{min,max}` amounts; `Recipe.ingredients` carry optional fluid
temperatures. There is no building/factory model yet (the `// building details` placeholder) — that
is the main known gap. `src/data.ts` loads `src/assets/static.json` at module level. Icons render
from a spritesheet (`src/assets/icons.avif` + `icons.json` position map, keys like `craft:<name>`)
via `components/resource.tsx`.

### Solver

There is no solver in this repo right now — the linear-algebra core was removed and will be
reintroduced later. `UI.md` describes the planner design it needs to serve; the two prior
implementations to draw on are `process-mgmt` (via `../process-mgmt-gui`) and proc-rs.

Tests in `test/` mirror the source layout (`test/scripts/`).

### TypeScript specifics

- Imports include explicit `.ts`/`.tsx` extensions (`allowImportingTsExtensions`);
  `verbatimModuleSyntax` means `import type` where applicable.
- `erasableSyntaxOnly` — no enums, namespaces, or parameter properties; scripts run directly under
  Node 24's type stripping.
- Preact with `react`/`react-dom` aliased to `preact/compat`; JSX uses `class=`, not `className`.

## Sibling repos (references, not dependencies to modify)

- `../factorio-loader` — the older codebase: many utilities, but focused on one specific
  save/use-case rather than being general. Its `web/pages/plan.tsx` is the supply-first manifest
  planner analysed in `UI.md §1`; `extract/*.lua` + `scripts/load-recs.ts` are its game-data
  extraction path. Its README notes the `process-mgmt` library is GPL — re-implement ideas from it
  rather than copying code.
- `../process-mgmt-gui` — the more modern calculator with much less scope: a demand-first
  linear-algebra planner (`src/calc.tsx`, `src/backend/mgmt.ts`) wrapping the `process-mgmt`
  library; analysed in `UI.md §2`.
- `../factoriolab` and `../factorio-raw-types` — checked out only because they're referenced (as
  data source and types package respectively).

## Abandoned attempts kept for scripts

`ballet0/` (was Remix) and `guava0/` (was Next.js) have had their web-framework code deleted; do not
develop them. Useful leftovers:

- `ballet0/scripts/shrink.ts` — pare a `RawData` dump down to selected keys;
  `ballet0/scripts/import-locales.ts` — bundle `*-locale.json` files; `ballet0/app/lib/` —
  blueprint-string and icon helpers.
- `guava0/scripts/translate-lab.ts` — load factoriolab's TypeScript data model directly
  (babel/pirates hook) to extract datasets like tech trees.
