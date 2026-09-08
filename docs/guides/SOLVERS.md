# Solver orientation and debugging

Read `FACTORIO.md` and `CELL.md` before changing domain behavior. This document explains how to
investigate cells whose recipes seem feasible but whose counts or resource balances look wrong. The
uranium fixtures in `test/assets/` are a concrete example. Read the current implementation and tests
as well: older architecture comments in `CONTEXT.md` and source files can lag behind changes.

## Where to look

| File                                          | Responsibility                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/cell.ts`                                 | Cell entries, explicit imports/exports, machine/effect resolution, structural interface |
| `src/flow.ts`                                 | Per-craft amounts, probability/productivity, gross and net per-machine rates            |
| `src/solve/index.ts`                          | Solver contract, `solveCell` adapter, explicit boundary handling, note text             |
| `src/solve/matrix.ts`                         | Simultaneous balance equations, pins, validation, fallback                              |
| `src/solve/rref.ts`                           | Dependency-free row reduction and rank decisions                                        |
| `src/solve/dumb.ts`                           | One-pass-per-row demand/surplus propagation                                             |
| `src/components/cell/box.tsx`                 | Resolves the solution and updates cell boundary settings                                |
| `src/components/cell/in-play.tsx`             | Resource chips and leftover warnings                                                    |
| `src/components/cell/in-play-connections.tsx` | Resource flows, import/export controls and explanations                                 |
| `src/components/cell/side.tsx`                | Cell inputs/outputs and forced-boundary highlights                                      |
| `src/components/cell/notes.tsx`               | Recipe notes and the cell-wide matrix fallback notice                                   |
| `src/components/cell/as-json.tsx`             | Debug JSON projection; not the complete solver state                                    |
| `src/pack.ts`, `src/url-handler.tsx`          | Cell persistence and versioned URL encoding                                             |

## Arithmetic and contracts

Each `SolveRow.rates` maps a resource to its net rate per second for **one machine**, after speed,
modules and beacons. Positive means production; negative means consumption. A recipe's input and
output of the same resource are netted. Gross `inputs` and `outputs` remain available for diagrams.

For resource `r`, the physical cell balance is:

```text
balance[r] = sum(row[i].rates[r] * count[i])
```

Pinned `CellEntry.count` values are constraints, never answers the solver may change. When no row is
pinned, both solvers seed the first row at one machine. Counts are fractional machine equivalents,
not rounded construction counts. Missing counts mean unresolved rows; partial balances omit them.

The default matrix solver finds resources with both positive and negative net rates, adds one
zero-balance equation for each, then adds the pinned-count equations. It supports cycles. It has no
production target, cost function or preference for which alternatives to run.

Inconsistent or underdetermined systems fall back to `dumbSolver`. Invalid numerical input or an
unusable unique answer (including negative machine counts) produces a failure instead. Inspect the
`fallback` note's `failure` field to distinguish these paths. Two solver selections showing the same
answer can simply mean the matrix solver delegated to the dumb solver.

The dumb solver repeatedly totals already assigned rows, proposes counts for unresolved rows that
could absorb surpluses or fill deficits, and excludes proposals contested by multiple rows. It
prefers rows with deficit-filling proposals, then takes the **largest** usable proposed count for
the selected row. Conflicting smaller proposals produce a note. Assigned rows are never revisited,
so recycled material arriving later cannot correct earlier counts. This is not a cycle solver.

`Solution.complete` is not a feasibility certificate: the dumb solver sets it when all rows have
counts even if their balances conflict. The boundary adapter can also set it false for a forbidden
flow direction. Inspect notes and physical balances, not just this flag.

## Explicit imports and exports

Being produced and consumed inside a cell does not mean a resource must balance to zero. The user
can mark `Cell.exports?: ResourceId[]` or `Cell.imports?: ResourceId[]` to express a boundary:

| Setting                               | Allowed net physical balance | Meaning                                                     |
| ------------------------------------- | ---------------------------- | ----------------------------------------------------------- |
| Neither, with producers and consumers | Zero                         | Internal resource must balance                              |
| Explicit export                       | Nonnegative                  | Surplus may leave; internal consumption still exists        |
| Explicit import                       | Nonpositive                  | Shortfall may be supplied; internal production still exists |

Zero is allowed for either explicit direction. The UI clears the opposite setting for the same
resource. Different resources can have different explicit directions.

`solveCell` removes explicit boundary resources from the net-rate maps sent to **either** solver.
After solving, it restores the original rate maps and computes those resources' physical balances
from the returned counts. Gross flows are retained throughout. A wrong-sign boundary balance adds a
solver note and marks the solution incomplete. Currently these notes attach to entry 0, even though
the problem concerns the resource; that attachment does not identify a faulty recipe.

This is equation removal followed by sign validation, **not an inequality optimizer**. It does not
search alternative free-variable assignments to satisfy an import/export bound. Removing too many
equations can make a system underdetermined; another count pin or a future optimization policy may
be needed. Never erase a boundary resource's physical consumption or production to make it appear
balanced. Calling `matrixSolver.solve` directly bypasses the cell's import/export handling.

`cellInterface` classifies resources structurally, independently of solved counts, and moves
explicit boundaries into `inputs` or `outputs`. Search scopes and the debug JSON use that
classification. The settings persist through `PackedCell` as resource names. State-shape changes
must remain backward compatible where possible: add optional properties and handle their absence.
Otherwise bump `UrlState.v` and attempt a migration; do not bump `HASH_VERSION` merely for a state
shape change.

## Uranium case study

`test/assets/uranium.state.json` pins three uranium-processing machines and contains six recipes:
ore processing, two fuel-cell recipes, two synthetic burning recipes, and advanced reprocessing.
`uranium.cell.json` records the original problematic solution. The isotope returned by reprocessing
is U-238; the useful product is `item:angels-neptunium-240`.

The desired export case consumes every U-234/U-235 output, burns every fuel cell, and reprocesses
every depleted cell, while exporting excess U-238. Without a boundary override, the matrix solver
also demands zero U-238 surplus. These equations contradict the pinned ore-processing count, so it
falls back. This is a boundary-model problem, not evidence that row reduction cannot handle cycles.

The original dumb result sizes ordinary fuel-cell production to consume the available U-238:
0.198399 machines instead of the 0.041011 supported by U-235. It consumes 0.319422 U-235/s while ore
processing supplies only 0.0660275/s, leaving a 0.253394/s deficit. Reprocessing later returns
2.452731 U-238/s, after those earlier counts have already been assigned.

With `exports: ['item:uranium-238']`, both solvers close the other intermediate balances. At the
fixture's resolved machines and loadout, the expected outputs are approximately:

- 7.9007091625 U-238/s;
- 0.04418183 neptunium-240/s;
- slag and waste water as additional byproducts.

An alternative fix is `imports: ['item:uranium-235']`. The matrix solver can then consume all U-238,
including recycled U-238, and calculate the additional U-235 supply. This describes a different
factory and still needs cycle support; the dumb solver's limitations remain. Allowing both U-235
import and U-238 export removes the constraint determining ordinary fuel production, so do not
assume their combination yields a unique answer without another pin.

## Debugging workflow

### Verified boundary suggestions

`solveCell` runs `src/solve/boundary-suggestions.ts` for either solver selection. It checks the
physical balances rather than trusting `complete`. For a failed cell, it first checks whether Matrix
can already balance the unchanged system; a propagation-only cycle failure does not need a new
boundary. Otherwise it removes each internal resource equation in turn and tests the remaining
system with Matrix. Only unique, finite, nonnegative answers that preserve pins, close every other
internal balance, and respect existing boundary directions become suggestions. The removed
resource's physical balance determines export versus import and the predicted rate. These trials do
not modify the cell or the displayed counts.

Suggestions live in `Solution.boundarySuggestions`, independently of recipe notes. In-play chips
show warning icons even when the current resource balance is zero. The in-play explanation links to
each alternative's resource details, where the existing import/export buttons apply it. Alternatives
are individual choices, not a recommendation to enable them all. Exports appear first. The selected
solver is also tested on each alternative; notes say when Matrix is needed.

The plutonium fixtures extend the uranium chain with plutonium breeding and pin seven processing
machines. The saved dumb answer balances U-238 while leaving U-235 and neptunium unbalanced.
Removing the U-238 equation gives the only verified single-resource export alternative:
approximately 17.7502361697 U-238/s, with every other internal resource balanced by Matrix. Unlike
the smaller uranium fixture, the dumb solver still fails after this export, which the suggestion
explicitly warns about. Importing neptunium, U-234, or U-235 are also mathematically valid
alternatives, but require external isotope supplies and describe different factories.

This is a diagnostic search over single boundaries, not an optimizer or a general feasibility proof.
It does not recommend underdetermined trials, combinations of boundaries, or changes to pins. Raw
`Solver.solve` calls remain arithmetic-only; use `solveCell` for these cell diagnostics.

### Investigation steps

1. Preserve the user's state and debug fixtures. Resolve the same progress, machines, modules and
   beacons as the UI. `solveCell` defaults to `NO_CHOICE`; calling it without the saved header's
   resolved `Chosen` can reproduce different rates. `test/cell-export.test.tsx` shows how to resolve
   the uranium fixture using `resolveChosen`.
2. Run both solvers through `solveCell` and inspect `counts`, all `notes` (including fallback
   `failure`), and `[...solution.balance]`. Maps stringify as `{}` unless explicitly converted.
3. Identify each resource's producers, consumers and desired boundary direction. Write its balance
   equation. Check whether a supposedly internal resource is actually an intended surplus or an
   externally supplied shortfall. A warning beside a recipe can originate from a resource mismatch.
4. Compare per-machine rates with recipe data and resolved effects. Probabilistic products use
   expected amounts. Productivity changes material ratios; speed changes machine counts. Catalyst
   exemptions live in `Product.ignoredByProductivity`. Read `INGEST.md` before investigating changes
   to ingested or synthetic recipe data.
5. Check rank/constraints before changing tolerances: an impossible zero-surplus equation will not
   become correct with different numerical thresholds. The reducer uses `1e-10` for rank/pivot
   decisions; application residual and balance checks use `1e-9`. Tiny residuals near zero are
   different from the uranium fixture's material deficits.
6. For a boundary hypothesis, rerun a copy of the cell with an explicit import or export. Verify the
   remaining internal balances, the boundary's sign, every pin, and the gross flows. If the
   remaining system is underdetermined, inspect which count has lost its constraint.
7. Add regression coverage at the appropriate layer: algebra with bare `SolveRow`s; resolved
   machines/effects/boundaries through `solveCell`; persistence through pack/unpack; UI interactions
   through accessible buttons. Do not assert only that every row received a count.

The debug JSON's top-level `inputs`/`outputs` omit unbalanced internal resources unless explicitly
classified as boundaries. The original uranium JSON therefore hides its U-235 deficit and U-238
surplus at the top level. Sum recipe flows or inspect `Solution.balance`. Its per-recipe rates are
already multiplied by solved counts; divide by a nonzero count to reconstruct a per-machine rate. An
unresolved or zero count cannot be used that way. `ratio` is a connected-machine ratio, not a
stoichiometric coefficient. The JSON also omits solver notes and is not a replacement for UrlState.

## Verification

Use Node 24. For solver/boundary changes, start with:

```sh
npx vitest run test/plutonium.test.tsx test/cell-export.test.tsx test/solve.test.ts test/solve/
```

`test/cell.test.ts`, `test/pack.test.ts`, and `test/cell-as-json.test.ts` cover adjacent contracts.
Run `npm test` and `npm run lint` before handing off; run `npm run build` for application changes.
Read `STYLING.md` and check its supported layouts when changing the resource controls or sides.
