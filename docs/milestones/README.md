# K2 milestone costs

The [building recipe list](k2-buildings.json) contains the construction inventories in this order:
**ma1, ma2, ma-science, late game 1, late game 2**. The late game inventories come from the existing
`m1.base64` and `m2.base64` files. Counts are independent totals of placing items in each blueprint,
not additions to the preceding milestone. This file covers 30 building types, four science packs,
and 56 recipes.

`buildings` gives each building's base ingredients, recursive recipe craft counts, and total
crafting work **per one building item**. `sciencePacks` gives the same costs and chains **per one
science pack** for automation, chemical, logistic and military packs, including their blank tech
cards and other intermediates. `recipes` contains each building, science pack and intermediate
recipe's ingredients, output quantity, and time per craft. Follow ingredient ids to the matching
recipe's `product`; stop at iron plates, copper plates, stone, biomass, or coal. All ids are bare
item or recipe ids. Fluids and their upstream production are excluded. Wood is expanded through its
water-only greenhouse recipe, so its material inputs are empty while its growth time remains. Coal
remains an additional mined base ingredient for coke used in steel.

Times are seconds at crafting speed 1. Summed recursive times measure crafting work across all
recipes, including wood growth, rather than elapsed factory time. Costs use fractional crafts and
expected yields (including sand's 7.5 average); research consumption, fuel, productivity, batch
rounding, and extra production machinery are excluded. Base ingredients have no recipe entries.
Military science consumes gathered biomass. Chemical science's sulfuric acid and the fluids used to
produce plastic and quartz are excluded under the same fluid accounting rule.

Regenerate this file from the checked-in K2 dataset and current blueprint files, without a game
installation:

```bash
node scripts/k2-buildings.ts
npm run format
```

The [generated catalogue](k2-catalogue.md) lists 80 early building items, their unlock technologies,
per-item plate costs, optional branches, and the complete m1/m2 building inventory. It covers the
existing complexity order through electric furnaces and adds flamethrower turrets explicitly.
[k2-costs.json](k2-costs.json) contains material vectors, research closures, blueprint inventories,
and per-building costs. [k2-data.json](k2-data.json) is the portable source snapshot for queries.
These are planning references; no milestone sequence or building quantities before m1 have been
decided yet.

For **m1 → m2**, reuse m1's building inventory and add **5,069 entities**:

| Cost                                                      |  Iron plates | Copper plates |
| --------------------------------------------------------- | -----------: | ------------: |
| Additional buildings, including their crafted ingredients |     11,944.5 |         3,966 |
| Newly required research                                   |        2,108 |         1,466 |
| Combined                                                  | **14,052.5** |     **5,432** |

New research costs **20 basic, 740 automation, and 720 logistic tech cards**. Whole-craft rounding
raises the combined iron requirement to **14,066** when starting with no spare intermediates. The
fractional figures are material equivalents, not a count of physical plate items to pick up. Stone,
wood, coal, fluids and gathered biomass remain separate inputs; see the full vectors.

## Queries

Run from the repository root with Node 24. Queries use the committed snapshot and need no Factorio
installation, network, development server, or browser.

```bash
# Full construction/research/combined breakdown, selected recipe crafts, and research goals:
node scripts/k2-milestones.ts m1 m2

# Pool shared intermediates, then round every recipe to whole crafts:
node scripts/k2-milestones.ts m1 m2 --whole-crafts

# Expand plate production too (K2's early recipe consumes two ore per plate):
node scripts/k2-milestones.ts m1 m2 --raw

# Total cost from no buildings or research:
node scripts/k2-milestones.ts empty m1
node scripts/k2-milestones.ts empty m2

# Prerequisite path to being able to produce chemical cards, with no invented building counts:
node scripts/k2-milestones.ts empty chemical-ready

# Explicitly complete ALL finite basic/red/green research, including side branches:
node scripts/k2-milestones.ts empty all-red-green

# After that, one electric furnace needs another 250 red, 250 green and 250 chemical cards:
node scripts/k2-milestones.ts all-red-green item:electric-furnace

# One building plus research, or a research-only goal (comma-separated technology ids work):
node scripts/k2-milestones.ts empty item:flamethrower-turret
node scripts/k2-milestones.ts empty tech:steam-power
node scripts/k2-milestones.ts empty tech:logistic-science-pack
```

The output's `construction.materials`, `research.materials`, and `total.materials` use `item:` and
`fluid:` ids. `science` uses the game's bare science-item ids. For example, with `jq`:

```bash
node scripts/k2-milestones.ts m1 m2 | jq '.total.materials["item:iron-plate"]'
```

Each endpoint can also be a `.base64` blueprint file or a milestone JSON file:

```json
{
  "buildings": { "boiler": 2, "steam-engine": 4, "offshore-pump": 1 },
  "recipes": [],
  "technologies": ["steam-power"]
}
```

`buildings` contains **placing item ids and total quantities at that milestone**, not increments.
`recipes` names production capabilities to unlock, without setting output quantities. `technologies`
adds explicit research goals. A blueprint supplies its placed buildings and configured recipes. Use
these fields to sketch smaller milestones before m1: automation cores, steam power, automation
cards, logistics/electronics, logistic cards, then steel furnaces and silicon processing. The
catalogue gives the research costs without requiring unrelated armor, decoration or combat branches.

## What the numbers mean

- Research is a union of prerequisite closures, following the approach in
  `../factorio-raw-types/scripts/tech-counter.ts`. Shared prerequisites are paid once. The
  baseline's required research is already paid. A lower complexity score never implies a technology
  has been researched. Add optional research to `technologies` when it is part of the actual
  milestone.
- Building requirements include every crafted ingredient recursively. Research goals also include
  configured recipes, their ingredient recipes, selected crafting machines and their ingredients,
  and the ability to make the research cards themselves. Trigger technologies cost no cards but
  remain explicit in `triggers`; for example oil processing requires mining crude oil.
- **Biomass is gathered through gameplay at this phase.** It is an external input, like harvested
  wood, rather than the later biomass-growth recipe. Fifty military cards require 20 biomass. This
  fixes the accounting boundary without changing the application's complexity model.
- Routes deliberately use the early same-name recipes, with basic oil processing for petroleum gas.
  Steel, beams, gears, circuits, glass, sand, coke and other intermediates are expanded. There is no
  enrichment, recycling, advanced-oil substitution, module productivity, or research productivity.
  Recipe unlock alternatives choose the lowest standalone complexity cost; this is a declared route
  policy, not a global optimization of every possible combined research plan.
- The default boundary stops at iron/copper plates, raw stone, coal, harvested wood, water, crude
  oil and gathered biomass. Ore remains an input where a recipe consumes it directly (e.g.
  concrete). `--raw` also expands plates to ores. Steel plates and stone bricks are always expanded.
- Default quantities use fractional crafts and expected yields. K2 sand yields 7–8 per craft, so its
  mean is 7.5. `--whole-crafts` rounds each recipe once after pooling all demand, reports surplus,
  and still uses that sand mean; it is not a worst-case resource guarantee. Combined construction
  and research are rounded together, so their rounded bills need not add to the combined bill.
- Building reuse is by **item count**, with no placement matching. Moving entities costs no
  materials. Removed buildings can supply recipe ingredients (e.g. assembler 1 → assembler 2); their
  raw materials are not refunded. `reused` reports these ingredients. Spare intermediates, science
  cards, starting inventory and reusable surplus from prior crafting are not assumed.
- Construction totals cover the supplied capital quantities. `requiredCraftingMachines` identifies
  selected machines needed for the recipes. `uncountedCraftingMachines` identifies those absent from
  the target inventory, without inventing their quantities. **m2 has no chemical plant or oil
  refinery**, although its configured military-card line requires their products. Add explicit
  counts for these if the milestone must produce all those inputs locally. Raw resource extraction
  and research labs likewise need explicit capital counts; the material boundary permits imports.
- The budget excludes operating fuel/electricity, ammunition stocks, turret fluids, machines'
  initial fluid fill, construction time, throughput, terrain clearing and losses to enemies. It
  prices the buildings and one-time research, not running the factory. Blueprints with item
  requests, tiles, unknown entities, or non-normal quality fail explicitly rather than silently
  omitting their costs.

## Reading the early tech tree

[`k2-science-tree.json`](k2-science-tree.json) exports the localized name, direct dependencies and
own card cost of 91 technologies: all 86 finite basic/automation/logistic technologies, including
the chemical and military card unlocks and optional branches, plus the five additional technologies
on the construction robotics branch. Costs are total cards per technology, excluding its
prerequisites. Oil processing retains its mining trigger and has no card cost. Every dependency is
included. Chemical-card research is included for the construction robotics branch.

Each technology's `researchTime` gives its research unit count, seconds per unit and total
lab-seconds at research speed 1, before lab speed or productivity bonuses and excluding
prerequisites. These are base research times, not elapsed times for a particular lab setup. Trigger
research has `researchTime: null`.

The export also records [TEST-PLAY.md](TEST-PLAY.md)'s research milestones 1–9, with parenthesized
requirements separate from goals: milestone 2 unlocks Logistics. “Circuit” in milestone 5 is
Electronics, which unlocks electronic circuits and is required for logistic cards. Milestone 9
reaches Construction robotics; its “flying robot frame” requirement is the Robotics technology that
unlocks that recipe. Banned choices remain in the complete tree and are listed separately. These
research milestones are distinct from the `m1`/`m2` blueprints. Regenerate with
`node scripts/k2-science-tree.ts`, then `npm run format`.

`k2-science.txt` and `scripts/complexity.ts` are useful rough ordering references. Their score is a
weighted availability measure, not the sum of cards actually consumed. In this export the model does
not recognize biomass mined from spawner corpses as an early gathered source. It instead prices
biomass using a much later production route, badly inflating the military pack's weight.
Consequently flamethrower turrets appear at about 71% while electric furnaces appear at about 32%.
The catalogue preserves those reference scores and includes flamethrowers explicitly; costs always
use actual card quantities and gathered biomass.

Unlocking chemical cards does **not** require finishing every basic/red/green technology. There are
also basic/red/green-only technologies sorted after the chemical-card unlock. `chemical-ready`
prices a required path; `all-red-green` explicitly selects all 86 finite technologies whose whole
prerequisite closure uses only those three card types. They are different planning choices.

The catalogue distinguishes side branches from literal leaves. A leaf has no declared downstream
technology; it can still unlock useful buildings, equipment, damage or inserter settings. A side
branch is merely unnecessary for the selected chemical-card/electric-furnace path. Neither label
means a technology should always be skipped.

Both reference blueprints are already past the first logistic cards: m1 configures quartz and
silicon, requiring silicon processing. m2 configures military cards, adding oil/plastics/advanced
circuits research even though no military cards are consumed by its minimum research closure. These
are capability milestones, not proof of research actually completed in a particular save.

## Regeneration and evidence

The export is the K2 dataset documented in [INGEST.md](../guides/INGEST.md): Factorio 2.1.21,
Krastorio2 2.1.3, and that installation's enabled mods. Regenerate after changing blueprints,
supported routes, or the export:

```bash
APP=~/ins/factorio/2.1.21 node scripts/k2-milestones.ts --refresh
npm run format
```

`--refresh` reads raw technology prerequisites and units, item-to-entity placement mappings, and
recipe ingredients/results, and recomputes reference complexity. It snapshots all technologies and
only the selected early production routes plus the blueprints' configured recipes. Coproduct routes
and unsupported probability distributions require an explicit policy. Late technology queries
requiring unrepresented packs fail instead of assuming they are free.

Use `node scripts/k2-milestones.ts --write` to regenerate the catalogue and cost summaries from the
committed snapshot after editing a blueprint. A newly configured recipe outside the snapshot
requires `--refresh`. SHA-256 fingerprints record the raw dump, both ingested K2 data files and both
blueprints. Regression tests verify that the portable evidence matches the checked-in files.
