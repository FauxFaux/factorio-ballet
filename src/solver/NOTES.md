# Solver design notes

The production-chain solver: given a fixed set of recipes and the rates the user
demands, compute how many of each building to run. It's a linear-algebra solve —
build one matrix of recipe stoichiometry + requirements, reduce to reduced
row-echelon form (RREF), read the answers from the last column. See
`../../ALGORITHM.md` for the long-form derivation and `../../FACTORIO.md` for the
problem domain.

## Module map

| File        | Responsibility                                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`  | Problem/solution data: `Problem`, `ActiveProcess`, `Requirement`, `MaterialFlow`, `Solution`. No logic.                                      |
| `rates.ts`  | Recipe → signed per-second rates for one building. `productRate` (rate semantics), `stackRates` (gross, per-stack), `processRates` (netted). |
| `matrix.ts` | `rref` — pure Gauss–Jordan over `number[][]`. No domain knowledge.                                                                           |
| `solve.ts`  | The glue: `getDefaultedItems` → `buildMatrix` → `rref` → read counts + materials, or report infeasibility.                                   |
| `index.ts`  | Public re-exports.                                                                                                                           |

Everything is pure functions over plain data (no Preact, no globals, no I/O), so
each module is unit-testable in isolation. Tests live in `test/solver/`.

## Pipeline

`solve(problem)`:

1. **`getDefaultedItems`** (`ALGORITHM.md §4`) — items appearing on only one side
   (consumed xor produced) across all processes, and not already declared I/O or a
   requirement, are auto-promoted to I/O so the system stays square. Intermediates
   (consumed **and** produced) get no slack — their balance equation forces the
   process ratios, which is how cycles resolve.
2. **`buildMatrix`** (`§3`) — rows = sorted distinct items; columns =
   `processes ++ I/O slacks ++ defaulted slacks ++ [requirements]`. A process column
   is the **netted** per-second rate per item (`-in + out`); a slack column is a
   single `1.0`; the last column holds requirement amounts. Returns the matrix plus
   row/column label arrays.
3. **`rref`** (`§5`) — Gauss–Jordan with partial pivoting. `pivotCols` is set to the
   variable-block width so the requirement column is never pivoted on (textbook-
   correct for an augmented system; `ALGORITHM.md §10.3 #3`). Tiny values are
   scrubbed to 0. Non-mutating.
4. **Readout** (`§6`) — for each process column, find its pivot row; the requirement
   value there is the building count. Materials are recomputed from the solved
   counts using **gross** per-stack rates.

## Decisions worth knowing

- **Hand-rolled RREF, no maths dependency.** ~40 lines, has to stay debuggable and
  editable. A library would obscure the exact pivoting/tolerance behaviour we care
  about.
- **Netted column vs gross materials.** The matrix process column nets a
  self-consumed item (`rock: -10 + 6 = -4`) because that's what balances. The
  **materials** readout instead accumulates each ingredient/product stack separately
  (`stackRates`), so an item consumed and produced within one process shows gross
  consumed (`-10`) and produced (`6`) with a net (`-4`). This is what makes cycles
  visible ("only really consumes 4 rock"). Don't collapse these two paths.
- **Expected-value product rates.** `productRate = probability × amount`, midpoint
  for `{min,max}`. It's the single function to change if we ever want worst-case/peak
  rates instead.
- **Structured infeasibility, not silent garbage.** A pivot row that is all-zero in
  the variable block but nonzero in the RHS ⇒ `{ ok:false, reason:'inconsistent' }`.
  A process column that never became a pivot ⇒
  `{ ok:false, reason:'underdetermined' }`. Both priors (`ALGORITHM.md §8`,
  `UI.md §3.4`) render bogus counts here instead.
- **Continuous counts.** Building counts are real numbers (e.g. 1.4); rounding is a
  display concern, never done in the solve.
- **Determinism.** Items are sorted (row order) and processes are sorted by id
  (column order), so the matrix and readout are stable.

## Gaps / not yet done

These are deliberately out of scope for the first cut. The return shape already
carries enough (`reason`, defaulted items, labelled matrix) to build on.

- **No building/factory model.** `ActiveProcess.multipliers` (duration / inputs /
  outputs) and `unmod` (catalysts) are typed and wired through `rates.ts`, but
  default to identity / empty. `types.ts`'s `Recipe` still has only the
  `// building details` placeholder — nothing populates the multipliers yet, so
  productivity and catalyst handling are present in code but untested against real
  data.
- **Fluid temperatures ignored.** `Ingredient.temperature` is on the type and in the
  data but the solver treats a `ResourceId` as one fungible item — it does not match
  a `>600°` requirement against a producer's output temperature. Temperature-keyed
  resources would need either distinct row ids or a matching pass.
- **No alternative-recipe selection.** The set of active processes is fixed by the
  caller before solving; the solver does not pick between competing producers of an
  item (that's why the two-makers-of-one-item case reports `underdetermined`).
- **Infeasibility detail is coarse.** `inconsistent` doesn't name the offending item
  (the row was zeroed by elimination); `underdetermined` names a process but not the
  best fix. The direction-aware import/export hints from `UI.md §2`/`§3.3`
  ("add an import for X") aren't built yet — this is where they'd go.
- **No optimisation / non-negativity.** This is a plain linear _solve_, not linear
  _programming_: solutions may contain negative counts or negative slacks, and there
  is no "minimise buildings / minimise raw inputs" objective.
- **Readout assumes process columns pivot first.** Counts are read positionally from
  the leading process columns. We detect the failure (`underdetermined`) rather than
  silently misreading, but we don't attempt to recover by reordering.
- **No UI wiring.** Pure engine only; the demand-first / supply-first entry points in
  `UI.md` are not connected.

## Tolerances

- `1e-10` — pivot-is-zero test (a column whose best candidate is below this is
  skipped) and the leading-entry / RHS checks in readout.
- `1e-12` — scrub threshold in `rref` (results below this are set to exactly 0).
