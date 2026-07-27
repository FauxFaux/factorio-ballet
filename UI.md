# Planner UI notes

Design notes from studying the two existing planners we're building a hybrid of. Goal: a planner on
top of our `StaticData` model (`src/types.ts`) that feeds an RREF matrix solver (not yet implemented
in this repo).

The two priors:

- **`factorio-loader`** — `web/pages/plan.tsx`. A "manifest" of hand-picked recipes with editable
  machine counts, plus a greedy auto-balancer. No real solver on the default page.
- **`process-mgmt-gui`** — `src/calc.tsx` + `src/backend/mgmt.ts`. A requirements-driven
  linear-algebra planner (the GUI that wraps the `process-mgmt` library, i.e. the TS ancestor of the
  proc-rs solver).

They sit at opposite ends: one is _supply-first_ (pick recipes, see the balance), the other is
_demand-first_ (state what you want, get recipes counted). Our hybrid wants both entry points
feeding one matrix solve.

---

## 1. `factorio-loader` plan.tsx — supply-first manifest

### What it does

- State is a `Manifest = { jobs: Job[] }`, `Job = { recipe, craftingSpeed, count }`
  (plan.tsx:22-30), packed into the URL (brotli + base64).
- The user adds recipes (`PickRecipe`, plan.tsx:518-609), each becomes a row in a `ManifestTable`
  with an editable integer `count` and a `craftingSpeed` multiplier (machine tier / modules).
- Per-job flow is `scale = (count * craftingSpeed) / recipe.time`, accumulated across jobs into a
  `Record<Colon, number>` net-effect map (`jobsEffects`, plan.tsx:82-90). The UI splits that into
  **Surplus / Missing / Balanced** columns (threshold `1e-4`).
- Recipe picking: lists every recipe producing the target item, sorted by a "badness" heuristic
  `products.length + Σingredient amounts + time/100` (plan.tsx:534-541). **No auto-pick** — the user
  chooses, and may add multiple producers for the same item (both just contribute to the net map).

### The balancer (the interesting bit)

`balance()` (plan.tsx:611-646) is a greedy demand-propagation loop:

```js
for (let i = 0; i < 300; ++i) {
  const current = jobsEffects(jobs); // recompute whole net map each pass
  for (const [colon, score] of Object.entries(current)) {
    if (score < 0 && canIncrease.includes(colon)) {
      const found = effects.findIndex((e) => e[colon] > 0); // first producer
      if (found === -1) continue;
      jobs[found].count += 1; // bump by ONE whole machine
      worked = true;
      break;
    }
  }
  if (!worked) return { jobs };
}
throw new Error("Failed to converge");
```

This is exactly the **iterative demand-propagation** family (the `RateCalculator` lineage) — and it
has the family's documented failure mode: loops/cycles never converge, so it bails after 300 passes
with a bare "Failed to converge". It also commits to the _first_ producer of a deficit item and
bumps in **whole-machine integer steps**, so it can't balance co-production or fractional ratios.

### Trouble

- **No cycle handling** (the core reason we want the matrix solver instead).
- Integer `count += 1` → can't express 1.4 machines; over/under-shoots ratios.
- "Badness" sort is arbitrary; no notion of "best" recipe, module cost, raw-input minimisation.
- `colourAmount` divides `effect/actual` with no zero guard (plan.tsx:307-326) → NaN/∞ colour bands;
  thresholds (±2/10/80%) are hand-picked.
- Export-to-process-mgmt path only handles **items, not fluids** (TODO at the fluid branch), and
  only takes the first job's products as requirements.
- Several hardcoded special cases (e.g. `boiler:biomass` fake recipe with magic numbers,
  plan.tsx:274-301; fuel inference; barrel synthesis) — domain hacks bolted onto the data rather
  than living in the data model.

### Worth stealing

- The **manifest-as-rows table** with per-row count + speed and live surplus/missing/balanced
  columns is a genuinely good _supply-first_ UI.
- URL-serialisable state (we already do this in `url-handler.tsx`).
- Footprint/area estimate is a nice touch (rough, but a useful signal).

---

## 2. `process-mgmt-gui` — demand-first linear-algebra planner

### What it does

- `CalcState = { requirements: Line[], processes: Proc[], defaultGroupPref }` (calc.tsx:33-37),
  URL-encoded.
  - `Line = { item, req: { op: 'auto'|'import'|'export'|'produce', amount } }`
    (requirement-table.tsx:17-20).
  - `Proc = { id, durationModifier, outputModifier }` (process-table.tsx:17-21); modifiers are
    game-aware `raw`/`normal`/`additional` (modifiers.tsx).
- Left column = `RequirementTable` (what you want / import / export / auto). Right column =
  `ProcessPicker` (search, plus `p:item` / `c:item` prefixes for producers/consumers) +
  `ProcessTable` (chosen processes with modifiers and solved counts). Below: `GroupPrefPicker`
  (which factory per factory-group) and `FlowSvg` (graph).
- Solve wires the `process-mgmt` visitor chain (mgmt.ts:118-131):
  `RateVisitor → ProcessCountVisitor → LinearAlgebra`. That is the rows=items /
  cols=processes++slacks++[req] RREF shape we want too.

### The hint loop (the interesting bit)

The headline feature is **auto-detection of imports/exports**, done as a **two-solve loop**:

1. `computeUnknowns` (mgmt.ts:133-158) runs a **throwaway** `mainSolve` purely to get
   `lav.augmented_matrix`, then walks each item _row_ and counts signed process entries:
   - `consumers>0 && producers===0` → **import**
   - `consumers===0 && producers>0` → **export**
   - `consumers===0 && producers===1 && wanted` → **import** (pin a thing no recipe makes)
2. `applyHints` (mgmt.ts:160-184) turns those into editable `op: 'auto'` requirement lines (exports
   listed before imports; if there are _no_ explicit requirements it promotes the first export to a
   `produce` goal of amount 1 — "you added recipes but no target, assume the dangling output is what
   you want").
3. `updateInputsWithHints` patches the auto-lines back in, then a **second** `mainSolve` produces
   the real answer.

This is proc-rs's `get_defaulted_items` squaring step, but **direction-aware** (signed slacks:
import `+1`, export `−1`) and pushed into the UI as a user-correctable hint loop instead of a silent
CLI warning. It's exactly the "needs better hints" UX the proc-rs README wants.

### Trouble

- **Two full solves** per state change (one just to infer unknowns). Correct but O(2n); the hints
  could come out of the real solve.
- **Rectangular-matrix = silent garbage.** When the system isn't square/consistent it warns
  "Rectangular matrix detected!" (calc.tsx:211-223) but still renders the bogus counts. Same as
  proc-rs: no real "no solution" detection.
- **Positional readout** of process counts (assumes process columns become the leading pivots in
  order) — fragile.
- **No catalyst / unmodifiable modelling** — only a single uniform `output_modifier` and inverted
  `duration_modifier`; can't do productivity-skips-catalyst correctly.
- **No cycle detection in the GUI** (relies on the matrix solver to absorb them).
- Datasets are pre-baked npm packages; no live data. `requirement-table.tsx:144` rebuilds the whole
  line array on every edit (`// TODO: surely we don't need this?`). `factory_type` is monkey-patched
  onto library `Process` objects.

### Worth stealing

- **Demand-first requirement table** with the `auto` op + hint loop is the right model for our
  solver — it's the UI form of `get_defaulted_items`.
- **Direction-aware import/export classification by walking matrix rows** is a far better diagnostic
  than proc-rs's set-difference: it can tell the user _why_ an item dangles and _which way_ it
  resolves → basis for "add an import here" hints.
- Game-aware modifier styles (raw/normal/additional) if we ever go multi-game.
- `p:`/`c:` search prefixes in the picker.

---

## 3. Implications for our hybrid

### Data model fit

Our `StaticData` (`src/types.ts`) already maps cleanly onto both:

- `Recipe { ingredients, products, duration }` → a process column. `products` already carry
  `probability` and `{fixed}|{min,max}` amounts; `ingredients` carry temperatures. That's richer
  than either prior (process-mgmt has bare `Stack`s).
- `ResourceId = item:… | fluid:…` is our colon. Same scheme both priors use.
- **Gaps to close before solving:**
  - No building/factory model yet (`// building details` placeholder) → no duration/in/out
    multipliers, no factory groups, no catalyst (`*_unmod`) split. We need these for the
    per-building rate calc and for productivity/catalyst correctness — the one thing process-mgmt
    got wrong.
  - `ProductAmount`/`probability` need a defined rate semantics (expected value?) before they hit
    the matrix.

### Architecture we want

1. **One matrix solver**: RREF with partial pivoting, `-in+out` net process columns, slack columns,
   requirement column. Borrow process-mgmt's improvement of **not pivoting on the requirements
   column** and its `1e-12` scrub for clean zeros.
2. **Two UI entry points over the same solve:**
   - _Demand-first_ requirement table (process-mgmt style) with an `auto` op.
   - _Supply-first_ manifest table (factorio-loader style) — adding a recipe is just adding a
     process column; "count" becomes a solved output, not a manual knob (with an option to pin it as
     a constraint).
3. **One hint pass, not two.** Get the import/export classification out of the _single_ real solve
   by reading signed row entries (process-mgmt's `computeUnknowns` logic) rather than running a
   throwaway solve first.
4. **Surface infeasibility instead of rendering garbage.** Detect non-square / rank-deficient /
   `[0…0|1]` rows and turn them into actionable hints ("unbalanced: pin an import for X / pick a
   producer for Y") — this is the union of both priors' weak spots and the biggest UX win available.
5. **Keep counts continuous** in the solve (1.4 machines), round only for display — never the
   integer `count += 1` greedy bump.

### Things neither prior does that we should

- Real **catalyst / unmodifiable** stacks (proc-rs has it; process-mgmt doesn't; factorio-loader
  doesn't model modules in the solve at all).
- **Alternative-recipe selection as a first-class step** (group preference picker is the closest
  prior; factorio-loader just lists everything). With our per-resource recipe index we can offer
  "which recipe for X?" before/within the solve.
- Treat **fluids** uniformly end-to-end (factorio-loader drops them on export).

### Open questions

- Expected-value vs worst-case for probabilistic `products`?
- How to present the `auto`/import/export hint loop without the two-solve cost and without
  process-mgmt's "rectangular → silent garbage" trap?
- Where do building/module multipliers live — extend `Recipe`, or a separate `Factory` layer keyed
  by recipe like process-mgmt's `factoryForProcess`?
