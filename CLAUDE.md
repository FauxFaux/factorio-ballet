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

### Committing

Before committing, always run `npm run lint` and `npm run format`. Do not commit if lint fails.

**Commit straight to `main`.** This is a single-author repo with no PR flow; do not branch, and do
not ask whether to. The whole history is linear on `main` and should stay that way.

Messages are [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`,
with the subject in lowercase imperative mood and no trailing full stop. The types in use are `feat`
(most of them), `fix`, `refactor` and `chore`; the scope is optional and is a part of the tree —
`ui`, `scripts` — omitted when the change spans the lot. Run `git log --oneline` for the house
style. Explain the _why_ in the body when it is not obvious from the diff: the design docs are the
source of truth for intent, and a commit body is the right place for the reasoning that did not earn
a paragraph in one.

### Data regeneration

`scripts/ingest-data.ts` converts a Factorio `data-raw-dump.json` + `*-locale.json` files (from the
game's `script-output/` directory) into `static.json`:

```bash
APP=<factorio-user-dir> node scripts/ingest-data.ts   # reads $APP/script-output/, writes ./static.json
```

The checked-in `src/assets/static.json` comes from `APP=~/ins/factorio-2-73-ab` (Bob's + Angel's);
regenerating from any other dump replaces the dataset. The script writes minified, and
`npm run format` prettifies it in place. Zod validators for the raw game data live in
`scripts/raw-validators.ts` (typed against the `factorio-raw-types` package).

**Adding a new attribute — read `INGEST.md` first.** It maps the available dumps, how to probe a 59
MB `data.raw` for which prototypes carry a field, how to verify a regeneration changed only what you
meant, what can and cannot be done about icons, and a measured field-by-field starting point for
modules and beacons.

Two things the ingest gets right that are easy to get wrong again:

- **Names come from the `*-locale.json` dumps, keyed by prototype id** (`scripts/locale.ts`, tested
  in `test/scripts/locale.test.ts`). The game has already resolved each prototype's
  `localised_name`, including parameterised templates we cannot expand — e.g. barrel items whose
  name is `["item-name.filled-gas-canister", ["fluid-name.<fluid>"]]` against bob's
  `filled-gas-canister=Bottled __1__` arrive as "Bottled Dinitrogen tetroxide gas". Do not
  reinterpret `localised_name`: that was tried, and it resolved nothing the dumps lacked while
  getting 37 names wrong. `resolveLocale` only filters the game's "Unknown item" sentinels.
- **`hidden` prototypes are dead content.** Mods disable things by setting `hidden` rather than
  deleting them (Angel's `functions.hide` / `OV.disable_recipe`), so e.g. both `angels-solid-rubber`
  and `bob-rubber` are in the dump when only the latter is real. Hidden recipes and hidden/parameter
  items and fluids are dropped, except resources a surviving recipe still references
  (`rocket-part`). Note `enabled: false` is _not_ a disable signal — that's just tech-gating. Items
  live under one `data.raw` key per subtype (`ammo`, `gun`, `module`, ...); the `ITEM_KEYS` list
  must cover them all or recipes end up referencing resources that do not exist.
- **A result with `probability: 0` is not a product** (`isProduced`, applied by both the ingest and
  `scripts/complexity.ts`). Angel's void sinks name a hidden marker item — `angels-water-void`,
  `angels-chemical-void` — as their sole result and then never roll it, which is the game's way of
  writing "and nothing comes out"; those 93 recipes are the only place in the dump the field is
  zero. Dropping the result leaves a clarifier as a recipe with no products, which is what it is: a
  sink. The markers were the reason the hidden-item rule above needed a void exception, and they are
  gone from `resources` now that nothing references them.

## Read the design docs first

The repo carries substantial design documentation; it is the source of truth for intent and is kept
current:

- `FACTORIO.md` — the problem domain in one page (recipes, rates, and the three complications:
  cycles, productivity, catalysts).
- `UI.md` — analysis of the two prior planner UIs (supply-first manifest vs demand-first
  requirements) and the hybrid design this app is building toward.
- `INGEST.md` — the game data as source material: which dumps exist, how to research `data.raw` for
  a new attribute, and what the icon spritesheet can and cannot do.
- `docs/string.wiki` — copy of the Factorio wiki page on the locale/localisation file format.

## Architecture

### App shell (`src/`)

`main.tsx` → `UrlHandler` → `CrashHandler` → `App`. All UI state lives in `UrlState` and is packed
into the URL hash (`url-handler.tsx`): JSON with sorted keys → deflate (with a dictionary derived
from the default state, duplicated in-file "for stability reasons") → base64url, prefixed with a
version letter (`HASH_VERSION = 'j'`). The dictionary is derived from the default state, so **adding
a field to `UrlState` invalidates every existing hash** — bump the version letter whenever the state
shape changes. State flows down as `State<T> = [value, setter]` tuples (`ts.ts`).

### Data model (`src/types.ts`, `src/data.ts`)

`StaticData = { recipes, resources, machines, sciencePacks }`. Resources are keyed by `ResourceId` —
the colon scheme `item:<name>` | `fluid:<name>` shared with both prior projects. `Recipe.products`
carry `probability` and `{fixed}|{min,max}` amounts; `Recipe.ingredients` carry optional fluid
temperatures. Machines are keyed by bare prototype id and carry `crafting_speed`, module slots, and
the `item` which places them; which machine can run which recipe is the game's category system —
`Recipe.categories` flattens the prototype's `category` + `additional_categories`, and `machinesFor`
in `src/data.ts` indexes `Machine.categories` the other way, slowest first so a machine family reads
as tiers. Modules, beacons, and machine power/pollution are still missing. Recipes and resources
also carry a `complexity`: how far through the tech tree you must be to have the thing, 0 at the
crash site to 1 at the last technology, derived by `scripts/complexity.ts` (which the ingest
imports). Search results sort by `relevanceOf`: distance from the header slider's game-progress
setting, in either direction, which is plain simplest-first at 0%. Machines are ranked the same way,
by `defaultMachine`, which is where an unpinned `CellEntry.machine` resolves — the game data gives a
machine no `complexity`, so `MachineMatch.complexity` is that of the item which places it (the same
walk, so not an approximation), and hand crafting is 0 because you start with the character.
`sciencePacks` is that walk's own list of research ingredients, cheapest first — the packs are the
only readable landmarks on the complexity scale, so the slider is labelled with their icons instead
of numbers (`components/progress-slider.tsx`, thinned by `packLandmarks` because ten of Bob's packs
land between 53% and 58%). `src/data.ts` loads `src/assets/static.json` at module level. Icons
render from a spritesheet (`src/assets/icons.avif` + `icons.json` position map, keys like
`craft:<name>`) via `components/resource.tsx`.

**Synthetic recipes** (`Recipe.synthetic`, `scripts/synthetic.ts`) are the sources the game has no
`data.raw.recipe` for: `synthetic:pumping-water` in an offshore pump, `synthetic:mining-coal` in a
drill. They are ordinary `Recipe`s with invented categories (`synthetic-pump:<fluid>`,
`synthetic-mine:<resource-category>`) run by drills and pumps promoted to `Machine`s, so search,
`machinesFor` and the rate maths need no special case; the flag exists so the UI can mark the card
rather than pass it off as something you could look up in-game. `scripts/complexity.ts` builds the
same set — splitting each one per machine, since you only need the cheapest — which is why the two
agree on ids. Rocket launches and burnt fuel are still complexity-only.

### Cells (`src/cell.ts`, `components/cell.tsx`)

A **cell** is a unit of work in a factory — a handful of recipes whose inputs and outputs are meant
to be closed and human-sized. `CELL.md` is the intent; `src/cell.ts` is the shape: a `Cell` is
`{ entries, name? }` and a `CellEntry` is `{ recipe, machine?, count? }` (modules later). The cells
being planned live in `UrlState.cl`, and `UrlState.ci` indexes the one being worked on — recipes
added from the search go there, and an out-of-range `ci` (which `[]` always is) means none is.

`cellInterface` is **set arithmetic, not rates**: used-and-not-made is an `input`, made-and-not-used
an `output`, and both is `internal`. Nothing scales the recipes against each other yet — that is the
solver's job, and `CellEntry.count` is where its answer (or the user's pin) will go — so an
unbalanced internal resource reads as "the cell handles this itself". `CellBox` lays a cell out as a
sankey diagram's shape without the sankey: inputs left, outputs right, recipes and their machines
between. A row's machine is a `MachinePicker` — a dropdown, because a cell is a column of rows and
the choice has been made; the search results keep the horizontal `MachineChip` row, where listing
every candidate and hovering for its numbers is the point. "Auto" is a real option in it rather than
the absence of one — named as `CellEntry.count`'s placeholder is, and meaning the same thing: it is
`entryMachine`'s default, so it walks up the tiers as the progress slider moves.

The cell also steers the recipe search. `searchRecipes` takes an optional `SearchScope` — the active
cell's open edges — which `makes:`/`uses:` resolve `@in`, `@out` and `@edge` against, so `makes:@in`
is "something which makes anything this cell has to be fed". That is the search for closing a cell
up, and the buttons on each side of a cell are how you get it without typing. An `@`-query outside a
cell matches nothing rather than everything.

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
- **ES2023** target and lib, app and scripts alike, so `findLast`, `at`, `toSorted` and friends are
  all available without checking.
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
- `../factoriolab` — checked out only because it's referenced as a data source.
- `../factorio-raw-types` — the types package the ingest validates against, and also the only place
  the icon spritesheet can be rebuilt: `scripts/sprite-sheet.ts` packs `src/assets/icons.avif` +
  `icons.json` from the game's per-prototype PNGs. Its key scheme has moved on from the one our
  checked-in sheet uses; see `INGEST.md`.

## Abandoned attempts kept for scripts

`ballet0/` (was Remix) and `guava0/` (was Next.js) have had their web-framework code deleted; do not
develop them. Useful leftovers:

- `ballet0/scripts/shrink.ts` — pare a `RawData` dump down to selected keys;
  `ballet0/scripts/import-locales.ts` — bundle `*-locale.json` files; `ballet0/app/lib/` —
  blueprint-string and icon helpers.
- `guava0/scripts/translate-lab.ts` — load factoriolab's TypeScript data model directly
  (babel/pirates hook) to extract datasets like tech trees.
