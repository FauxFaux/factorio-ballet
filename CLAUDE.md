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

For a UI change, prefer asking the user to look at the already-running dev server over driving it
with Playwright: this container has no working browser install, so a screenshot attempt burns time
and often fails outright, while the user's own browser is faster and is the real target anyway.

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
- `docs/beacons.wiki` — copy of the Factorio wiki page on beacons, including the
  transmission-strength table the beacon arithmetic is checked against.

## Architecture

### App shell (`src/`)

`main.tsx` → `UrlHandler` → `CrashHandler` → `App`. All UI state lives in `UrlState` and is packed
into the URL hash (`url-handler.tsx`): ids numbered (`pack.ts`) → JSON with sorted keys → deflate
(with a dictionary, a literal reference state in-file "for stability reasons") → base64url, prefixed
with `HASH_VERSION`. The dictionary is a state of the current shape, so **adding a field to
`UrlState` invalidates every existing hash** — bump the version letter whenever the state shape
changes. State flows down as `State<T> = [value, setter]` tuples (`ts.ts`).

`src/pack.ts` is why a hash of a hundred recipes is ~950 characters rather than ~2200: a prototype
id is a name — the game has no numeric ids — and at 26 characters apiece the names were most of the
payload, so `packCells` swaps each for its position in the dataset's `Object.keys`. That position is
a fact about one `static.json`, so the second half of `HASH_VERSION` is a fingerprint of every id
`pack.ts` numbers, and a regenerated dataset invalidates old hashes automatically rather than
silently reading them as the wrong recipes. Two things the shape is careful about: an id the dataset
does not have packs as the name it already was, so a stale URL survives a round trip through the
app; and `modules` packs as pairs rather than an object, because a loadout's order is the order it
fills the slots and JS enumerates integer-like object keys in numeric order whatever you insert.

Styles are plain CSS, one file per component, imported by the component itself
(`components/cell.tsx` → `components/cell.css`) — Vite concatenates them into one bundle in import
order. `index.css` is globals only: the `:root` custom properties, `#app`, `code`. `app.css` is the
shell — the header and the two-column layout, including the widths of `.resource-list` and
`.recipe-list`, which belong with the media query that overrides them rather than with the lists.
There is no scoping, so the class names stay prefixed by component and a couple are shared across
files (`.recipe-hint`, `.search-btn`); every file is loaded on every page, so that works, but put a
new rule where its markup lives.

### Data model (`src/types.ts`, `src/data.ts`)

`StaticData = { recipes, resources, machines, modules, beacons, belts, sciencePacks }`. Resources
are keyed by `ResourceId` — the colon scheme `item:<name>` | `fluid:<name>` shared with both prior
projects. `Recipe.products` carry `probability`, `{fixed}|{min,max}` amounts and the catalyst share
productivity is not paid on (`ignoredByProductivity`); `Recipe.ingredients` carry optional fluid
temperatures. Machines are keyed by bare prototype id and carry `crafting_speed`, module slots, and
the `item` which places them; which machine can run which recipe is the game's category system —
`Recipe.categories` flattens the prototype's `category` + `additional_categories`, and `machinesFor`
in `src/data.ts` indexes `Machine.categories` the other way, slowest first so a machine family reads
as tiers. Machine power and pollution are still missing. Recipes and resources also carry a
`complexity`: how far through the tech tree you must be to have the thing, 0 at the crash site to 1
at the last technology, derived by `scripts/complexity.ts` (which the ingest imports). Search
results sort by `relevanceOf`: distance from the header slider's game-progress setting, in either
direction, which is plain simplest-first at 0%. Machines are ranked the same way, by
`defaultMachine`, which is where an unpinned `CellEntry.machine` resolves — the game data gives a
machine no `complexity`, so `MachineMatch.complexity` is that of the item which places it (the same
walk, so not an approximation), and hand crafting is 0 because you start with the character.
`sciencePacks` is that walk's own list of research ingredients, cheapest first — the packs are the
only readable landmarks on the complexity scale, so the slider is labelled with their icons instead
of numbers (`components/progress-slider.tsx`, thinned by `packLandmarks` because ten of Bob's packs
land between 53% and 58%). `src/data.ts` loads `src/assets/static.json` at module level. Icons
render from a spritesheet (`src/assets/icons.avif` + `icons.json` position map, keys like
`craft:<name>`) via `components/resource.tsx`.

`src/flow.ts` is the arithmetic between a `Recipe` and a card: amounts per craft, rates per second
at a given machine's speed, and the decimal precision, decided once per recipe over every machine it
could run in so the numbers do not change width as the pointer moves along the machine list. No
scaling of one recipe against another — that is the solver's, and it is not here.

**Modules** are the 15 of the pack's 30 which change speed or productivity; efficiency and pollution
modules are not ingested, because there is no power or pollution model for them to pay into.
`StaticData.modules` is keyed by bare prototype id — a module is an item, so its name, icon, stack
size and complexity are already on the `item:<id>` resource, and `Module` carries only `category`,
`tier` and the two effects. Effects are the fraction added _per module_ and are linear in the number
of them: three `speed-module-3` at `speed: 0.4` is 2.2×, not 1.4³. `moduleEffects` (`src/flow.ts`)
does that sum and returns the two multipliers, one on the machine's speed and one on everything the
recipe produces; `fillSlots` is the "and what if I fill all three slots with these" case.
`modulesFor` (`src/data.ts`) is which modules a machine will take on a recipe, and is where the
three ways of overstating throughput live: `Machine.allowedModuleCategories` refuses a module
outright (absent means all — that absence is the only home Angel's bio-yield modules have),
`Machine.allowedEffects` ignores the effects it omits rather than refusing the module (which is why
speed modules work in an oil refinery, whose list has no `quality`), and productivity does nothing
at all unless `Recipe.allowProductivity`, which only 335 of 2330 recipes set. See `INGEST.md`.

What is in a machine is `CellEntry.modules`, a `ModuleFill` of how many of each: the order the user
chose them in is the order they fill the slots, and `moduleEffects` drops whatever no longer fits
rather than scaling it, because a loadout outlives the machine it was picked for. `withModule` edits
one; `entryEffects` resolves one against the row's machine.

**Beacons** are the other place a speed module goes, and `StaticData.beacons` is the three this pack
has (`beacon`, `bob-beacon-2`, `bob-beacon-3`) with their slots — 2, 4, 6 — and a
`distributionEffectivity` of 1.5 throughout. A beacon is not a `Machine` (it runs no recipes) and
what it is for is getting past the machine's own slot count, at a discount which worsens as you
build more: each of `n` beacons transmits `distributionEffectivity / sqrt(n)` of what is in it, so
`n` full ones come to `1.5 × sqrt(n)` and the second beacon is worth 41% of the first
(`docs/beacons.wiki`). The game reads that penalty out of a per-beacon `profile` table rather than
computing it; ours is the square root, and `checkBeacons` in the ingest asserts the dump's profile
agrees to 4dp rather than shipping the table. Only speed reaches a machine this way — every beacon's
`allowedEffects` says so — and the machine has to have module slots of its own to receive anything
at all, which is the game's rule and the reason a pump cannot be beaconed.

A row states **how many modules of each family it wants**, not where they go: two counts,
`CellEntry.productivityModules` and `CellEntry.speedModules`, laid out by `moduleLayout`
(`src/flow.ts`) over the slots the row's own loadout left. The two are asked separately because the
game answers them separately — a productivity module has nowhere to be but the machine's own slots,
so that count is capped there, while speed has beacons and so no ceiling — and wanting both at once
is the ordinary case rather than an exotic one.

**Which family** either count is spent on is the machine's answer and not the row's. `moduleFor`
(`src/data.ts`) picks, among the families named for that effect, the best module the header has
chosen that this machine will take — two families are picked for productivity, `productivity` and
Angel's `angels-bio-yield`, and Angel's farms name no `allowed_module_categories` at all, so they
take both. Neither "the productivity family" nor "the one the machine allows" answers it, and what
does is which is worth more here: bio-yield is pure yield at up to +50% against +20% with a speed
malus, so a farm grows on the agricultural modules and an assembler runs on the ordinary ones. The
speed malus is not weighed against the yield — that is a judgement about a factory, and the row has
a speed box to make it with. `familyFor` is the same question asked of the dataset rather than of
the header, which is what an empty box draws with its lights out, and `Layout.families` carries both
answers to the row.

The order is arithmetic and not a preference: productivity takes its slots first, because a slot is
the only place it can go and one spent on speed is one it cannot have; speed fills whatever is left
and beacons the rest, losing nothing by being asked second. **A typed speed count does not take a
slot back off productivity** — a beacon reaches a machine whose own slots are full, which is exactly
what beacons are for. The two autos differ for the same reason: productivity's is "as many as fit",
and none at all where the recipe or the machine would ignore them (a speed malus bought for
nothing), while speed's is whatever slots that left and no beacons. `laidOutEffects` is
`moduleEffects` with a `Layout` on top, so both go through the same gates and cannot disagree about
what the machine applies; both of a module's numbers ride along wherever it sits, which is what
makes a productivity module a speed malus as well as a yield, and `applyBoost` is the one place
either is gated. Which beacon gets built is not a choice yet (`rowBeacon` in `src/data.ts`, the
vanilla two-slot one): a bigger beacon is fewer beacons for the same modules and so a _better_
answer, which is not something to have jump about as the progress slider moves.

Which _tier_ is meant by "a speed module" — or a productivity one — is a fact about the save rather
than about any one machine, so it is one setting in the header rather than a repeated choice:
`moduleCategories` is the families the dataset has — `speed`, `productivity` and `angels-bio-yield`,
which the UI calls "agricultural" because a `module-category` prototype has no name to ingest — and
`ModuleBar` (`components/module.tsx`) is a `ModulePicker` for each, sitting right of the progress
slider it defaults from. The choices live in `UrlState.mo`, a `ModuleChoice` keyed by category with
three states which are all different: a module id, `null` for none, and _absent_ for auto, which
follows the slider through `defaultModule`. `chosenModule` resolves one; `chosenModules` resolves
the two a row can spend into a `ChosenModules`, which `App` does once and hands down to the cells,
so a row counts modules and names a family but never a module.

`defaultModule` is deliberately **not** `defaultMachine`'s nearest-`progress` rule — it is the best
tier you could already have built, and none until that is nothing. The difference is that none
exists: a machine has to be _some_ machine, so nearest is the best a default can do there, whereas
naming a tier-1 speed module at 20% progress overstates a factory with no modules in it at all. None
is a complexity of zero — you have empty slots at the crash site — so it holds until the family is
unlocked, and it is pinnable too, for the player who is not using that family at all.

**Belts** are the other constraint on a cell: not how fast it can make something, but how much of it
can leave. `StaticData.belts` is the six tiers this pack has, keyed by bare prototype id like a
module — a belt is placed by an item of the same id, so the name, icon, stack size and complexity
are on `item:<id>` already — and carries one number, `itemsPerSecond`: 15 for the vanilla yellow, 60
for bob's turbo. The game states `speed` in tiles per tick; items sit a quarter of a tile apart on
each of two lanes, so items/s is `speed × 60 × 4 × 2`. Only the belt is ingested. Its underground,
its splitter and the loaders each restate the same speed, and `checkBelts` asserts every one of the
25 belt-shaped entities here runs at some belt's speed, so a tier stays one number rather than four.
Nothing consumes this yet.

**Catalysts** are the other half of productivity, and are ingested rather than derived: a result's
`ignored_by_productivity` is the share the recipe borrowed rather than made — the 40 of the 41
uranium-235 kovarex hands back, the milling drum a powderiser returns — and `productAmount` pays the
bonus on `amount - ignoredByProductivity` only, clamped at zero because the game's number can exceed
the whole result. 208 results here carry it, and half of them name a resource the recipe never takes
as an ingredient (the drum goes in lubricated), which is why "the share which is both in and out"
would be the worse of two readings — but it is a convention of 2.0's recipes and not a promise of
the format (1.1's engine derived the catalyst and the dump stated nothing), so `checkCatalysts` in
the ingest and a test over the shipped file both assert that every product-also-ingredient on a
productivity recipe states `min(in, out)`. What is still not modelled is the catalyst which goes
round a cycle of two recipes rather than one: that needs a solver which closes cycles.

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
`{ entries, name? }` and a `CellEntry` is
`{ recipe, machine?, count?, modules?, productivityModules?, speedModules? }`. The cells being
planned live in `UrlState.cl`, and `UrlState.ci` indexes the one being worked on — recipes added
from the search go there, and an out-of-range `ci` (which `[]` always is) means none is.

`cellInterface` is **set arithmetic, not rates**: used-and-not-made is an `input`, made-and-not-used
an `output`, and both is `internal`. Which of those a resource is does not depend on the solver and
must not — the search scopes are built from it — so the rates the solver works out are laid over
that classification rather than changing it, and an internal resource which does not balance is
drawn as a leftover on the `internal` row. `CellBox` lays a cell out as a sankey diagram's shape
without the sankey: inputs left, outputs right, recipes and their machines between. A row's machine
is a `MachinePicker` — a dropdown, because a cell is a column of rows and the choice has been made;
the search results keep the horizontal `MachineChip` row, where listing every candidate and hovering
for its numbers is the point. "Auto" is a real option in it rather than the absence of one — named
as `CellEntry.count`'s placeholder is, and meaning the same thing: it is `entryMachine`'s default,
so it walks up the tiers as the progress slider moves. Beside it is `ModuleBoxes`, two integers: how
many productivity modules and how many speed modules this row is to feel, blank in either for auto,
with the whole layout — where each module went, how many beacons the speed took, and what the
machine ends up running at — in the tooltips. There is deliberately no beacon count on the row
itself: a cell is a column of rows, and the beacons are an answer rather than a thing to decide. The
productivity box is capped at the machine's slots. A box whose modules could not reach the machine
goes invisible rather than away — `Layout.reaches`, which is the machine having slots at all, its
`allowedEffects`, and for productivity the recipe's permission too, so a pump draws neither box and
an ordinary recipe draws only the speed one. Invisible and not absent because the rows of a cell
read as columns, and a box which came and went would shuffle every other one along; each box's icon
and its tooltip name the family that box is actually spending, which is how a farm row says
"agricultural" where an assembler says "productivity".

The cell also steers the recipe search. `searchRecipes` takes an optional `SearchScope` — the active
cell's open edges — which `makes:`/`uses:` resolve `@in`, `@out` and `@edge` against, so `makes:@in`
is "something which makes anything this cell has to be fed". That is the search for closing a cell
up, and the buttons on each side of a cell are how you get it without typing. An `@`-query outside a
cell matches nothing rather than everything.

### Solver (`src/solve.ts`)

A solver turns the counts the user pinned into the counts they did not: fifteen steel furnaces, so
how many coke plants (`FACTORIO.md`). `solveCell` reduces each `CellEntry` to a `SolveRow` — the
`netRates` of one machine, plus the pinned `count` if there is one — and hands the rows to a
`Solver`. There is one, `dumbSolver`, and the interface exists because there will be more: the
linear-algebra core this repo used to carry (`git show c14f792`) handles the cycles this one cannot.

The dumb solver is demand propagation, one row per pass against a freshly totalled balance: seed
(the pinned rows, or one of the top row if nothing is pinned), find a row which makes what the cell
is short of or uses what it has spare, scale it, repeat. `rows.length` passes is exactly enough for
a chain in the worst order, and a cycle simply runs out of rows to scale.

**It is allowed to fail, and the failure is the feature.** A row it cannot work out keeps no count
and stays `auto`; the rates it does know still total into `Solution.balance` and still read on the
cell's edges (marked partial). Everything it assumed or gave up on is a `SolveNote` against the row
it happened to, rendered both as a ⚠ on that row and as a sentence under the cell, each one ending
in what the user could type to resolve it. The three it raises: `contested` (two rows could both
absorb the same resource — it will not pick, because that would make the answer depend on the order
recipes were added in), `conflict` (one row pulled two ways: scaled to the larger, and the loser
named), and `stranded` (nothing connects the row to the rest).

A row is solved at the machine it is in, with what is in that machine's slots and whatever beacons
its speed count came to: `rowOf` reads `entryEffects` — `solveCell`'s third argument is
`ChosenModules`, what the header means by a module of each family, resolved once by `chosenModules`
in `App` — and hands `netRates` the two multipliers, so an unpinned row's modules move with the
progress slider exactly as its machine does. Productivity changes what a row is worth without
changing what it eats, which is a real answer and not a scaling: the same three assemblers of gears
consume the same plates and hand on 36% more gears, so downstream counts fall and upstream ones do
not. `UI.md` describes the wider planner design the solver eventually serves.

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
