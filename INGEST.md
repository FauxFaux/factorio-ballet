# INGEST.md

How to research the game data when adding a new attribute to `static.json`. `CLAUDE.md` records the
rules the ingest already encodes; this is the map of the source material and the method for
extending it.

## The dumps

`scripts/ingest-data.ts` reads a Factorio user directory's `script-output/`. Several exist on this
machine; they are not interchangeable, and the checked-in `src/assets/static.json` comes from one
specific pack:

| `APP=`                     | modpack                    | raw recipes | note                       |
| -------------------------- | -------------------------- | ----------- | -------------------------- |
| `~/ins/factorio-2-73-ab`   | Bob's + Angel's (+reskins) | 2621        | **the checked-in dataset** |
| `~/.factorio`              | Space Age, no other mods   | 659         | vanilla reference          |
| `~/ins/factorio-2-0-72`    | pyanodons                  | 11612       | stress test for scale      |
| `~/ins/factorio-2-0-72-py` | pyanodons                  | 11612       | same pack                  |

`~/code/factorio-raw-types/raw-110/` and `raw-script-output/` are that package's own small samples
(212 and 681 recipes); useful for a quick shape check, not for regenerating.

Identify a pack from `$APP/mods/mod-list.json`. Confirm you regenerated from the right one by the
counts the script prints — the checked-in file is `Recipes: 2330`, `Machines: 161`,
`Resources: 1761`, `Modules: 15`.

## What a `script-output/` holds

- `data-raw-dump.json` — the whole of `data.raw` after mods load, ~59 MB.
- `*-locale.json` — the game's own resolved names and descriptions, keyed by prototype id, one file
  per locale namespace. The filename prefix _is_ the `type` argument to `resolveLocale`: `item`,
  `fluid`, `recipe`, `entity`, `technology`, `equipment`, `tile`, `quality`, `recipe-category`,
  `item-group`, `virtual-signal`, `shortcut`, and a few more. Items of every subtype (modules, ammo,
  tools…) share the one `item` namespace; machines are entities, so they resolve against `entity`.
- Per-type directories of one PNG per prototype (`item/`, `recipe/`, `entity/`, `fluid/`,
  `technology/`, …) — this is the only icon artwork the game exports. If a `script-output/` also
  holds `icons.png` / `icons.json`, those were packed afterwards by the tool in [Icons](#icons), not
  written by the game. The ingest reads none of them.
- `mod-settings-dump.json`, and `../mods/mod-list.json` alongside.

## Researching the dump

Do not `grep` or `cat` it. Load it in Node and probe:

```bash
node --max-old-space-size=4096 -e "
const d = require('$APP/script-output/data-raw-dump.json');
console.log(JSON.stringify(d.module['speed-module-3']));
"
```

**To find which prototype types carry a field**, scan every `data.raw` key rather than guessing.
This is how `ITEM_KEYS` and `MACHINE_KEYS` were arrived at, and it is the first thing to run for any
new attribute:

```js
for (const [key, protos] of Object.entries(d)) {
  if (typeof protos !== "object" || !protos) continue;
  const n = Object.values(protos).filter((p) => p && p.crafting_categories).length;
  if (n) console.log(key, n, "/", Object.keys(protos).length);
}
```

**Probe the value distribution before you add a schema field.** `AssemblingMachinePrototype`
documents `ingredient_count`, but no machine in the Bob's/Angel's pack sets it, so `Machine` does
not carry it. Conversely, a field being unused _here_ does not mean it is unused generally — module
`limitation` is empty in this pack but is how 1.1 restricted productivity modules to intermediates
(see [modules](#notes-for-modules-and-beacons)). Prefer a comment noting the case over silently
assuming it away.

**Beware the difference between "set" and "true".** 442 recipes set `allow_productivity`; only 420
set it to `true`.

## Verifying a regeneration

Re-running the ingest must not disturb the fields already in the file. Diff old against new with the
new keys stripped — anything but `0` means you used a different dump:

```js
const a = require("./src/assets/static.json"),
  b = require("./static.json");
const strip = (r) => {
  const { categories, ...rest } = r;
  return JSON.stringify(rest);
};
console.log(
  Object.keys(a.recipes).filter((k) => strip(a.recipes[k]) !== strip(b.recipes[k] ?? {})).length,
);
```

Every cross-reference the ingest introduces should print a completeness check, so a wrong assumption
shows up as a number rather than a missing icon three screens later. There are four so far: dangling
resource refs (catches an `ITEM_KEYS` gap), recipe categories with no machine (catches over-eager
`hidden` filtering), modules with no item, and modules no machine will take (catches reading
`allowed_module_categories` as a list to enumerate rather than a restriction). Each prints nothing
when it is happy. Add the equivalent for whatever you introduce.

## Icons

The spritesheet is built from the game's per-prototype PNGs by
**`../factorio-raw-types/scripts/sprite-sheet.ts`** — no script in _this_ repo produces it:

```bash
cd ../factorio-raw-types
npm run generate-sprites -- ~/ins/factorio-2-73-ab/script-output   # writes icons.png + icons.json there
avifenc -s 0 -q 50 --qalpha 20 <that>/icons.png src/assets/icons.avif
```

(`npm run import-sprites` chains those two, but hardcodes `~/.factorio/script-output` and the
raw-types repo's own `data/` output, so it is not the path for regenerating this app's assets.)

It resizes each PNG to 32×32 (contain, transparent background), deduplicates tiles by SHA-512 of the
raw RGBA, and packs them into a near-square grid — hence `src/assets/icons.avif` being 2048×2048, a
64×64 grid of 32px cells, with `icons.json` holding 4617 keys over only 3091 distinct cells
(`recipe:speed-module-3` and `craft:speed-module-3` are both `[64, 32]`).

**The checked-in `icons.json` predates a key-scheme change, so regenerating today will not drop
in.** Our file has exactly two namespaces: `craft:<name>` covering items **and** fluids, and
`recipe:<name>`. `factorio-raw-types` commit `9460547` ("icons types / icons keys", 2026-07-27 — one
day after these assets were generated) split that into the `entity:` / `fluid:` / `item:` /
`recipe:` / `tech:` scheme now declared by its `src/icons.ts`. A regeneration therefore means
updating the lookups in `components/icon.tsx`, `components/resource.tsx` and `components/recipe.tsx`
to match.

The upside of doing so: the current scheme emits `entity:` icons, which the `craft:`-era sheet has
none of. That is why `character` has no icon today and borrows light armour's via
`MACHINE_ICON_STANDIN` in `components/recipe.tsx` — a regeneration would give it, and every other
machine, its real entity artwork and make the standin unnecessary.

Until then you cannot mint a key from within this repo, so check coverage before designing any UI
around a new prototype kind:

```js
const icons = require("./src/assets/icons.json");
console.log(Object.keys(d.module).filter((n) => !icons["craft:" + n]));
```

## Notes for modules and beacons

Modules and beacons are both ingested. Measured against the Bob's/Angel's pack:

- **`data.raw.module`** — 30 prototypes, none hidden. Carries `category` (a `module-category` id),
  `tier`, and `effect` as a record of `speed` / `productivity` / `consumption` / `pollution` /
  `quality` multipliers (e.g. speed module 3 is `{speed: 0.4, consumption: 0.7, quality: -0.3}`). 15
  of them change speed or productivity and are kept as `StaticData.modules` with those two numbers;
  the other 15 are the efficiency and pollution families, which this app has no power or pollution
  model to spend on. The effect values arrive with the mods' float noise (`0.30000000000000004`) and
  are rounded to 4dp like everything else.
- `limitation` / `limitation_blacklist` — the per-recipe whitelist, and how 1.1 kept productivity
  modules on intermediates — are unused in this pack, and 2.0 moved that decision to the recipe as
  `allow_productivity`. `factorio-raw-types` does not declare them either, so they are not ingested;
  a pack which used them would need `Module`'s doc comment revisited. `maximum_productivity` appears
  on no recipe here, so the game's +300% cap is never the binding one and is not modelled.
- Modules are items, so they are already in `resources` with names, stack sizes, and icons — and
  `Module` is keyed by that same bare prototype name, carrying nothing the item already has. The
  ingest checks every module has its item. The spritesheet covers all 30 as `craft:<name>`, so a
  module picker can show icons today.
- **`data.raw['module-category']`** — `productivity`, `speed`, `efficiency`, `pollution-clean`,
  `pollution-create`, `god`, `angels-bio-yield`. Nothing has category `god` here.
- **Machines** carry `moduleSlots`, and now `allowedEffects` / `allowedModuleCategories`. Both are
  **absent for "no restriction"**, and the second one is why: no machine's whitelist names
  `angels-bio-yield`, and the twelve Angel's farms which name no whitelist are the only place those
  five modules can go. Miss that and a third of the modules we keep are dead. Still un-ingested:
  `effect_receiver` (5 machines, a per-machine base effect rather than a module thing — and the four
  setting `uses_module_effects: false` have no module slots to ignore anyway).
- The two restrictions do not work the same way. `allowed_module_categories` refuses the module;
  `allowed_effects` **ignores the effects not in it** and takes the module regardless. That has to
  be so: 143 machines allow productivity but not quality, and speed modules — which carry a quality
  malus — go in all of them, exactly as they do in the game.
- **`data.raw.beacon`** — `beacon`, `bob-beacon-2`, `bob-beacon-3`, with `module_slots` 2/4/6 and
  `distribution_effectivity` 1.5 throughout. Beacons have no `crafting_categories`, so they are not
  machines under the current model and have their own record: `StaticData.beacons`, keyed by
  prototype id, with the slots, the effectivity, the placing item and the same two absent-means-all
  restriction lists a machine carries. Every one of them allows `speed` and not `productivity`,
  which is the game's rule about what goes in a beacon, as data rather than as an app's assumption.
- **`profile` is the transmission penalty, and it is not ingested — it is checked.** 2.0 does not
  compute `1 / sqrt(n)`: each beacon carries a 100-entry `profile` whose `n`th value is what each of
  `n` beacons transmits, and the app applies the square root the wiki describes
  (`docs/beacons.wiki`). All three beacons here ship the vanilla profile, which _is_ that square
  root to 4dp, so `checkBeacons` asserts the two agree rather than shipping 300 numbers to
  interpolate between. A mod with a flatter profile would make us overstate a beaconed row, so the
  check is the thing that has to fire, not the field that has to exist. `beacon_counter` (`total` /
  `same_type`) and the quality bonus fields are not modelled at all: this app has no floor plan to
  count beacons on and no quality mode.
- **Recipes** carry `allow_productivity`, which gates whether productivity applies at all — a
  minority of recipes (420 true of 2621 raw; 335 of the 2330 live ones), so a UI that assumes
  otherwise will overstate throughput badly. This one is ingested, as `Recipe.allowProductivity`,
  emitted only when true: the game's default is off and the 17 live recipes setting it explicitly
  false mean the same thing as the 1978 leaving it unset. `allow_quality` (333) and
  `allow_decomposition` (669) are also present, and are not.
- **Results** carry `ignored_by_productivity`: how much of that result the bonus is _not_ paid on,
  which is the catalyst rule and is now ingested as `Product.ignoredByProductivity` (emitted only
  when non-zero; 208 live results carry it). Its sibling `ignored_by_stats` is a production-graph
  display flag and is not ingested. `extra_count_fraction`, which would also move a rate, is on no
  result here.
- **Do not derive the catalyst share from "the resource is on both sides" — and do not trust the
  field blindly either.** Both halves of that matter:
  - Deriving it would miss most of them. 109 of the 208 name a resource the recipe does not take at
    all, because a catalyst can go in as one thing and come back as another:
    `angels-milling-drum-lubricated` in and `angels-milling-drum` out, `angels-catalyst-metal-red`
    in and `angels-catalyst-metal-carrier` out, molten tin in and tin _ingots_ out of
    `angels-plate-glass-3`. Nor is the share bounded by either amount: `angels-fish-keeping-3` takes
    four rays, returns one and ignores three, so `productAmount` clamps the paid part at zero.
  - Trusting it blindly is what 1.1 would have punished. In `../factorio-raw-types/raw-110/`,
    `kovarex-enrichment-process` and `coal-liquefaction` state **no `catalyst_amount` at all**,
    though the game pays no productivity on the 40 uranium-235 kovarex hands back: 1.1's engine
    derived the catalyst from the ingredients, so the data stage said nothing and a calculator had
    to work it out itself. 2.0 renamed the field and the recipes state it — this pack's kovarex says
    40 — but that is a convention of the recipes, not a guarantee of the format.
  - So it is checked, in `checkCatalysts` and again in `test/flow.test.ts` over the shipped file:
    every product which is also an ingredient of a recipe allowing productivity must state a share
    equal to `min(in, out)`. 29 pairs here, 0 failures. If a pack ever reports failures, the fix is
    to derive the share in `toProd`, and that report is the evidence which justifies it. The other
    78 pairs are on recipes which disallow productivity, so nothing pays a bonus and what the field
    says cannot matter; eight of those state nothing at all (`angels-heavy-water-cooling` and
    friends: 200 water in, 200 out), which is exactly the shape that would bite if such a recipe
    ever allowed productivity.
- The recipe gate and the machine gate never disagree in this pack: every machine which refuses the
  productivity effect only runs recipes which disallow productivity anyway. `test/modules.test.ts`
  says so, so a future pack breaking that is a failing test rather than a wrong number.

## Notes for belts

- **`data.raw['transport-belt']`** — 6 prototypes, none hidden, each placed by an item of its own
  id, all six covered by the spritesheet as `craft:<name>`. `speed` is **tiles per tick**: an item
  occupies a quarter of a tile along the lane it is on and a belt has two lanes, so items per second
  is `speed × 60 × 4 × 2` — yellow's `0.03125` is 15/s, bob's turbo `0.125` is 60/s. That is the
  only number ingested (`StaticData.belts`, `Belt.itemsPerSecond`); a belt has nothing else the app
  wants, and it is an entity placed by an item, so the name, icon, stack size and complexity are
  already on the item.
- **Six other prototype types state a belt `speed`**: `underground-belt`, `splitter`, `loader`,
  `loader-1x1`, `linked-belt` and `lane-splitter` (25 prototypes between them here, `BELT_KEYS` in
  `scripts/raw-keys.ts`). They are the same tier's number written out per entity shape, so none of
  them is ingested — but nothing in the format says a mod could not slow a splitter below the belt
  feeding it, so `checkBelts` asserts every one of them matches some belt's speed. 0 off here.
  Angel's/Bob's adds a full basic/turbo/ultimate set of each, plus AAI's six `loader-1x1`s; the
  three vanilla `loader`s, `linked-belt` and `lane-splitter` are hidden, which is the game's own
  script-only content rather than a mod disabling anything.
- Belt throughput in the game is a lane-level thing — a belt half-fed carries half as much, and
  sideloading and undergrounds are where a real line loses its compression. `itemsPerSecond` is the
  fully compressed figure, which is the one a plan is checked against. Fluids do not travel this way
  at all; a barrel is an item like any other.

`FACTORIO.md` explains why productivity is one of the three things that make the maths hard; the
arithmetic over this data is `moduleEffects` and `productAmount` in `src/flow.ts`.

## Progression ("how far through the game is this?")

`scripts/complexity.ts` scores every resource and recipe 0–1 for how deep into the tech tree you
must be before you can first make one. It reads the dump directly
(`APP=... node scripts/complexity.ts`), prints a landmark table and a histogram, and takes substring
filters or `--tech`. The ingest imports `analyse` and writes the numbers out as `Recipe.complexity`
/ `Resource.complexity`.

The model, and the two non-obvious parts of it:

- **A science pack is worth all the science already spent to unlock it**, with automation science as
  the unit — logistic is 676, chemical 1.3M, space 1.8e13. That is circular (a technology's cost is
  denominated in packs) but the dependency graph _of packs_ is acyclic, so a fixed point falls out
  in five passes. The weights come out exponential, matching how the game feels — 2000 automation
  science is a rounding error next to 400 logistic — and a `log10` at the end turns that back into a
  readable percentage. 100% is the most expensive technology in the tree.
- **A resource costs the max of its recipe's unlock cost and each ingredient's own cost**, minimised
  over the recipes that produce it: a minimax shortest path. The max is the point — a recipe
  unlocked at 10% whose ingredient only exists at 60% is a 60% recipe.

**Four sources of a resource are not recipes**, and without all four large parts of the graph never
become reachable at all:

- `minable` / `loot` on naturally placed prototypes — ores, trees (Angel's gardens are trees), fish,
  biter artifacts. This is the hand-mining route, so it costs nothing.
- **`offshore-pump`, which conjures `fluid_box.filter` out of the tile it stands on.** This is where
  water comes from (the vanilla pump names no filter and means water), and it is the _only_ entry to
  Angel's mud line: `angels-seafloor-pump` is filtered to `angels-water-viscous-mud`, and every mud
  recipe consumes mud. Miss it and mud, clay, clay bricks, and the tier-2 ore buildings are all
  unobtainable. Model it as a conversion from the item that places the pump, so the fluid inherits
  the pump's unlock technology.
- `rocket_launch_products` — the only source of space science in a pre-Space-Age pack.
- `burnt_result` — depleted fuel cells.

The first two are now built by **`scripts/synthetic.ts`** and shared with the ingest; see
[Synthetic recipes](#synthetic-recipes) for the shape and the rates. The other two stay inside
`complexity.ts`.

Unreachable resources then get a second pass pricing them on their unlock technology alone. That
list is a completeness check, not a feature: with all four sources modelled it is 2 (bob fuel cells
Angel's replaced), and a long list means another source like the seafloor pump is still missing.

## Synthetic recipes

`scripts/synthetic.ts` turns the two machine-shaped non-recipe sources into `Recipe`s and `Machine`s
so the app can show them: `synthetic:pumping-water` (2 in this pack, one per fluid a pump can carry)
and `synthetic:mining-coal` (17, one per placed resource patch), over 21 machines. Both
`ingest-data.ts` and `complexity.ts` call it, which is what keeps their ids in step.

The rate conversions are the fiddly part, and all three follow from `Machine.speed` meaning "crafts
per second of a one-second recipe":

- **Pumps.** `pumping_speed` is fluid _per tick_, so the recipe is quoted as "one second, 60 fluid"
  and the speed is `pumping_speed` unchanged. The vanilla pump reads 20× on 60 water, i.e. 1200/s,
  which is what it does.
- **Miners.** `mining_speed` per second against `minable.mining_time` seconds is already the model,
  so both go across as they are. Patch richness is not modelled: a pumpjack's real output scales
  with the well's yield percentage, and these are the 100% numbers.
- **`minable.fluid_amount` is stated ten times too large.** The prototype value must be divisible by
  ten and the game divides it out again, so the `10` on every infinite ore is one acid per ore.

Two exclusions are load-bearing, both about Angel's heavy offshore pump, which is an `offshore-pump`
you place that swaps itself for a `mining-drill` on a hidden `angels-sea-pump-resource`:

- a pump or drill with **no placing item** is half a building, not a production option;
- a resource with **no `autoplace`** is a mod's own scaffolding.

Drop either test and that one pump emits its 1500 water/s twice. The completeness check for all this
is the existing "recipe categories with no machine" line — a synthetic recipe is only emitted when a
machine can run it, so a category turning up there means the two halves have drifted apart.
