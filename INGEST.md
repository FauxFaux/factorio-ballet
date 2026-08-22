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
`Resources: 1763`.

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
`limitation` is empty in this pack but is how vanilla restricts productivity modules. Prefer a
comment noting the case over silently assuming it away.

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
shows up as a number rather than a missing icon three screens later. There are two so far: dangling
resource refs (catches an `ITEM_KEYS` gap) and recipe categories with no machine (catches over-eager
`hidden` filtering). Add the equivalent for whatever you introduce.

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

Measured against the Bob's/Angel's pack, for whoever picks this up:

- **`data.raw.module`** — 30 prototypes, none hidden. Carries `category` (a `module-category` id),
  `tier`, and `effect` as a record of `speed` / `productivity` / `consumption` / `pollution` /
  `quality` multipliers (e.g. speed module 3 is `{speed: 0.4, consumption: 0.7, quality: -0.3}`).
  `limitation` / `limitation_blacklist` — the per-recipe whitelist — are unused in this pack but not
  in vanilla. `maximum_productivity` appears on no recipe here.
- Modules are items, so they are already in `resources` with names, stack sizes, and icons. A
  `Module` record should key off the same bare prototype name, not a new id scheme.
- **`data.raw['module-category']`** — `productivity`, `speed`, `efficiency`, `pollution-clean`,
  `pollution-create`, `god`, `angels-bio-yield`.
- **Machines** already carry `moduleSlots`. Still un-ingested: `allowed_effects` (158/165
  assemblers), `allowed_module_categories` (153/165), and `effect_receiver` (only 2 — a per-machine
  base effect, not a module thing). Missing means "no restriction", so read them as optional, not as
  empty.
- **`data.raw.beacon`** — `beacon`, `bob-beacon-2`, `bob-beacon-3`, with `module_slots` 2/4/6 and
  `distribution_effectivity` 1.5 throughout. Beacons have no `crafting_categories`, so they are not
  machines under the current model and need their own record.
- **Recipes** carry `allow_productivity` (420 true of 2621), which gates whether productivity
  applies at all — a minority of recipes, so a UI that assumes otherwise will overstate throughput
  badly. `allow_quality` (333) and `allow_decomposition` (669) are also present.

`FACTORIO.md` explains why productivity is one of the three things that make the maths hard; the
module data is what that section will need.
