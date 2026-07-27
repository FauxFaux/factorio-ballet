# The Production-Chain Solver

This document describes the algorithm `proc-rs` uses to solve the production
chain problem: _given a set of recipes, how many of each building/machine do
we need to run in order to satisfy a set of requirements?_ (See
`FACTORIO.md` in the `faucalc` repo for the problem domain.)

It is deliberately scoped to the **solver**. The WebAssembly bindings
(`src/lib.rs`), the web UI (`www/`), the data-set parsers
(`src/data/*_data_parse.rs`), and the Graphviz rendering are not covered
except where they feed the solver.

The whole solver is a linear-algebra calculation: build one matrix that
encodes every recipe's stoichiometry plus the user's requirements, reduce it
to reduced row-echelon form (RREF), and read the answers out of the last
column.

Relevant source:

- `src/data/calculator.rs` — the solver itself (`Calculator`).
- `src/data/model.rs` — `ActiveProcess` (rate computation), `Stack`, `StackSet`.
- `src/data/graph_configuration.rs` — `GraphConfiguration`, the problem
  statement that is handed to the solver (requirements, processes,
  imports/exports, and the "defaulted item" logic).

---

## 1. Vocabulary

- **Item** — a thing that can be consumed or produced. Has an `id`, a
  `display` name and a `Classification` (Solid / Liquid / Gas / Fluid /
  Energy). Items are the _rows_ of the matrix.
- **Process / recipe** — converts input `Stack`s into output `Stack`s over a
  `duration`, in some factory group. A `Stack` is `(item, quantity)`.
- **ActiveProcess** — a process placed into the configuration together with a
  concrete `Factory` and three multipliers (duration / inputs / outputs). It
  is responsible for turning per-cycle recipe quantities into **per-second
  rates** (Section 2). Each active process is one _process column_ of the
  matrix.
- **Requirement** — `(item, quantity)` the user demands as a _net_ rate.
  Positive = "produce this much per second"; negative = "must consume this
  much per second".
- **Import / Export (I/O)** — an item the solver is allowed to freely source
  or sink. Each I/O item becomes a free _slack column_. The solved value tells
  you how much is imported (consumed) or exported (produced).
- **Defaulted item** — an item that appears in the recipes but the user
  neither pinned as a requirement nor declared as I/O, and that is _not_ an
  internal intermediate. These are auto-promoted to I/O so the system stays
  square and solvable (Section 4).
- **Intermediate** — an item that is both consumed and produced by the chosen
  processes. It gets _no_ slack column; its balance equation is what forces
  the relative process counts (this is how cycles are resolved).

---

## 2. From recipe quantities to per-second rates (`ActiveProcess`)

Recipes are written as "N items per cycle". The solver works in **items per
second per building**, so every quantity is divided by the (modified) cycle
duration. This is done in `ActiveProcess::io_calc` (`model.rs:189`).

Effective duration:

```
duration = process.duration
         * factory.duration_multiplier
         * active.duration_multiplier
```

For each input/output stack:

- **Modifiable** stacks (the normal `inputs` / `outputs`):
  `rate = multiplier * quantity / duration`
  where `multiplier = active.{in|out}puts_multiplier * factory.{in|out}puts_multiplier`.
- **Unmodifiable** stacks (`inputs_unmod` / `outputs_unmod`):
  `rate = quantity / duration` — the multiplier is **not** applied.

Stacks for the same item are then summed.

This split is exactly how the three FACTORIO.md complications are modelled:

- **Productivity bonuses** → the outputs multiplier on the _modifiable_
  outputs.
- **Catalysts** (an item that is consumed _and_ produced and must not be
  affected by productivity) → put it in the `*_unmod` lists so the multiplier
  is skipped.

So one process, after `ActiveProcess::inputs()` / `.outputs()`, is a set of
signed per-second rates for a _single_ running building.

---

## 3. Building the matrix (`Calculator::create_initial`, `calculator.rs:29`)

The matrix is `rows = items`, `cols = processes ++ io ++ defaulted ++ [requirements]`.

- **Rows** — the set of all distinct items that appear as an input or output
  of any included process (`all_proc_io`, a `BTreeSet`, so rows are sorted by
  item ordering / id).
- **Columns**, in this fixed order:
  1. **One column per process** (iterated via a `BTreeMap` keyed by process
     id, so sorted by id). For each item row the entry is the _net_ per-second
     rate for one building:
     `entry = (-input_rate) + (output_rate)`.
     Inputs are negative, outputs positive; an item that is both consumed and
     produced _within one process_ is netted here.
  2. **One column per import/export item, then one per defaulted item**
     (the two lists are chained). Each is an indicator/slack column: `1.0` in
     that item's row, `0` elsewhere — i.e. partial-identity columns.
  3. **One final column for the requirements.** For each requirement
     `(item, quantity)` the item's row holds `quantity` (may be + or −).

The matrix is the augmented system

```
[ P | S | r ]
```

representing `P·x + S·y = r`, where

- `x` = unknown process counts (number of buildings),
- `y` = unknown I/O amounts (the slack values),
- `r` = the requirement column (constants / RHS),
- each row is one item's net-balance equation:
  `Σ_proc (rate · count) + (slack if the item is I/O) = required net rate`.

### Worked example

From the test `it_calculates_initial_matrix` (`calculator.rs:351`):
requirement `part_3 = 7`, I/O `part_1`, `part_2`, and process `make_a`
(`5×part_1 + 2×part_2 → 5×part_3`, duration 1s):

```
        make_a  io1   io2   req
part_1 [ -5.0,  1.0,  0.0,  0.0 ]
part_2 [ -2.0,  0.0,  1.0,  0.0 ]
part_3 [  5.0,  0.0,  0.0,  7.0 ]
```

Read as equations:

```
part_1:  -5·m + io1 = 0
part_2:  -2·m + io2 = 0
part_3:   5·m       = 7
```

---

## 4. Keeping the system square (`get_defaulted_items`, `graph_configuration.rs:289`)

A unique solution needs `#unknown-columns == #rows`, i.e.
`#processes + #io + #defaulted == #items`.

`get_defaulted_items` makes this hold automatically:

1. `I` = set of all process input items, `O` = set of all process output
   items.
2. `diff = I △ O` (symmetric difference) — items that appear on only **one**
   side across all processes. (Items in both, the _intermediates_, are
   excluded — they must be balanced by process counts, not by a slack.)
3. Remove anything already declared as I/O or as a requirement.
4. Whatever remains is "defaulted" and gets a slack column.

In the CLI (`bin/main.rs:199`) these are then explicitly added as
imports/exports with a warning ("Found unsatisfied item, adding as
import/export"). Net effect: every item row is balanced by exactly one of —
a process pivot, a declared slack, an auto-defaulted slack, or the requirement
constant — so the variable block is square and (when the recipes are
independent) full rank.

`get_intermediate_items` is the mirror image (`I ∩ O`, minus I/O and
requirements) and is informational only.

---

## 5. Solving: Gauss–Jordan elimination (`Calculator::reduce`, `calculator.rs:93`)

The whole augmented matrix (variable columns **and** the requirement column)
is reduced to **reduced row-echelon form** with partial pivoting:

```
pivot_row = pivot_col = 0
while pivot_row < nrows and pivot_col < ncols:
    r = row at/below pivot_row with the largest |value| in pivot_col   # partial pivot
    if |M[r, pivot_col]| < 1e-10:        # column is effectively zero
        pivot_col += 1                   # skip it (free / dependent column)
    else:
        swap rows pivot_row, r
        for every other row i:           # eliminate above AND below -> full RREF
            f = M[i, pivot_col] / M[pivot_row, pivot_col]
            subtract f × pivot_row from row i
        scale pivot_row so its pivot becomes 1
        pivot_row += 1; pivot_col += 1
```

Notes:

- It eliminates from **all** other rows (not just below), so the result is
  RREF, not merely upper-triangular.
- **Partial pivoting** (`find_row_with_max_magnitude`) picks the largest-
  magnitude pivot for numerical stability.
- A column whose candidate pivot is below `1e-10` is treated as zero and
  skipped, advancing only `pivot_col`. This is the implicit handling of a
  rank-deficient / under-determined system.

After reduction the example above becomes
(`it_reduces_for_slightly_more_complex_form`):

```
        make_a  io1   io2   req
part_1 [  1.0,  0.0,  0.0,  1.4 ]   # make_a = 1.4 buildings
part_2 [  0.0,  1.0,  0.0,  7.0 ]   # io part_1 = 7.0 /s  (= 5 × 1.4)
part_3 [  0.0,  0.0,  1.0,  2.8 ]   # io part_2 = 2.8 /s  (= 2 × 1.4)
```

The variable block has become the identity and the last column holds each
variable's solved value.

---

## 6. Reading the answer

### Process counts (`process_counts`, `calculator.rs:136`)

The first `#processes` columns are the process variables, in sorted-id order.
After RREF the answer is simply the last column: `count(process_i) =
reduced[i, last_col]`. The code maps the sorted process ids to
`last_col[0 .. #processes]`.

This relies on the first `#processes` columns each being pivot columns whose
pivots sit in rows `0 .. #processes` — which holds when the processes are
linearly independent and (being leftmost) are reduced first.

### Materials (`materials`, `calculator.rs:147`)

Given the solved counts, this recomputes the _actual_ throughput: for every
process it multiplies each input/output rate by that process's count and
accumulates signed stacks into a `StackSet`. `StackSet` can then report, per
item:

- `sum_negative` — total consumed (≤ 0),
- `sum_positive` — total produced (≥ 0),
- `sum` — the net.

The net is used to classify each item as net-consumer / net-producer /
net-equal (e.g. for graph colouring and the materials table). A pure
intermediate nets to ~0; a requirement or I/O shows the expected surplus or
deficit. This is also where **cycles** become visible: an item produced and
re-consumed internally shows large consume/produce values but a net near zero
(the "only really consumes 4 rock" effect from FACTORIO.md).

---

## 7. How the three FACTORIO.md complications are handled

| Complication                                                       | Mechanism                                                                                                                                                                                                                                |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cycles** (a chain consumes its own output)                       | Intermediates get no slack column; their per-row balance equation forces process ratios, and within-process self-consumption is netted in the process column (`-in + out`). The linear system resolves the loop directly — no iteration. |
| **Productivity** (machine makes more output)                       | `outputs_multiplier` (factory × active), applied to _modifiable_ output stacks in `io_calc`.                                                                                                                                             |
| **Catalysts** (consumed+produced item, unaffected by productivity) | Put the stack in `inputs_unmod` / `outputs_unmod`; `io_calc` skips the multiplier for those. Self-consumption is also netted in the process column.                                                                                      |

---

## 8. Assumptions and limitations

- **Square / consistent / full-rank is assumed.** `process_counts` blindly
  reads `last_col[0..#processes]`; if the system is under-determined (loops or
  missing I/O), over-determined (conflicting requirements), or a process
  column failed to become a pivot, the reported counts can be wrong or
  meaningless. There is no explicit "no solution" or "needs more I/O"
  detection — the README's "Loop/no-solution: Needs better hints" notes this
  gap.
- **No non-negativity / feasibility constraint.** This is a plain linear
  _solve_ (Gauss–Jordan), not linear _programming_. Solutions may contain
  negative process counts or negative slacks; nothing rejects or optimises
  them. There is no objective function (e.g. "minimise buildings" or "minimise
  raw inputs") and no choice between alternative recipes — the set of active
  processes is fixed by the configuration before solving.
- **Rates are continuous.** Process counts are real numbers (e.g. 1.4
  buildings); the solver does not round to whole machines.
- **`1e-10` tolerances** are used both for the pivot-zero test and for
  net-zero classification.

---

## 9. End-to-end flow (for reference)

`GraphConfiguration` (requirements + active processes + declared I/O) →
auto-add defaulted items as I/O (`bin/main.rs`) →
`Calculator::generate`:

1. `create_initial` builds `[P | S | r]`,
2. `reduce` produces the RREF,
3. `process_counts` reads building counts from the last column,
4. `materials` reconstructs per-item consume/produce/net.

A minimal way to exercise it without the WASM/web layer is the `generate`
subcommand of the CLI binary (built with `--features main`), e.g.:

```
cargo run --features main -- generate \
  -i fac-2.0.0 -s basic -f www/data/fac-2.0.0.json \
  -r 5:part_d -p make_d:1:1:1
```

or directly through the unit tests in `calculator.rs`, which assert the exact
initial and reduced matrices for several fixtures.

---

## 10. Cross-implementation notes: `process-mgmt` (TypeScript, branch `feat/ts-2`)

`~/code/process-mgmt` is an earlier/parallel attempt at the same problem, with
a rough TypeScript port on branch `feat/ts-2`. The relevant calculation code
lives in `src/visit/` (and `src/rate_process.ts`, `src/stack.ts`). Reviewing
it surfaces several useful contrasts and one clear lineage insight.

### 10.1 Two solver generations coexist (the key insight)

process-mgmt contains **two** different solvers; proc-rs only reimplements the
second one.

1. **`RateCalculator` / `RateChain.update` (`rate_calculator.ts`,
   `rate_process.ts`)** — the _original_, iterative **demand-propagation**
   algorithm. It is a worklist/DFS: start from the requested output stack, pick
   _one_ process that produces it (`select_process`), compute its building
   count with `process_count_for_rate = duration * wanted / output_qty`, add
   its outputs and subtract its inputs from a running `materials` `StackSet`,
   and push any still-unsatisfied input back onto the queue (unless it's an
   import). It credits existing surplus, so it nets within a single forward
   sweep.

   Its limitation is exactly the FACTORIO.md **cycles** problem: a recipe that
   consumes its own output, or a loop `A→B→A`, keeps pushing requirements and
   never converges to a global balance. It also greedily commits to one
   producer per item, so it cannot balance co-production.

2. **`LinearAlgebra` (`linear_algebra_visitor.ts`)** — the matrix/Gauss–Jordan
   solver, the direct analogue of proc-rs's `Calculator`. This is the evolution
   that handles cycles by solving the whole system at once.

So proc-rs is effectively a clean-room reimplementation of _only_ the
LinearAlgebra path. The takeaway: the matrix approach didn't appear in a
vacuum — it replaced a queue-based propagation solver specifically because the
iterative one can't close cycles. If proc-rs ever wants a fast
"acyclic/simple" path, the `RateCalculator` is the prior art (and its
limitations are documented).

### 10.2 Same core idea as proc-rs

The `LinearAlgebra` visitor matches proc-rs structurally:

- Rows = items, columns = `processes ++ slacks ++ [requirements]`.
- Each process column is the **net** stoichiometry (`Column` wraps a
  `StackSet`; inputs `.sub()`, outputs `.add()` — equivalent to proc-rs's
  `-in + out`).
- Rates are per-second: `RateProcess` divides every stack by `duration` (and
  sets duration to 1), just like proc-rs's `io_calc`.
- Solve = Gauss–Jordan to RREF; building counts are read out of the last
  (requirements) column, mapped to the process columns (which are sorted by id
  and placed first), exactly as in proc-rs.

### 10.3 Interesting deviations

1. **Imports vs exports are split, with signed slack columns.** proc-rs has a
   single `import_export` list and every slack column is `+1`; direction is
   inferred afterwards from the solved sign. process-mgmt keeps separate
   `imported` (slack `+1`) and `exported` (slack `-1`) lists, baking direction
   into the matrix (`_create_import_export_matrix(..., value)` with `value = 1`
   for imports, `-1` for exports). Same math, but the user must categorise up
   front.

2. **Auto-"defaulted items" lives in a different layer and works differently.**
   proc-rs's `get_defaulted_items` auto-adds every dangling item
   `(inputs △ outputs) − declared_io − requirements` as I/O (a single unsigned
   `+1` slack bucket) to guarantee a square system, and the CLI just does this
   silently-with-a-warning. The core `process-mgmt` _library_ has no such step
   — but the capability is not missing, it is **driven by the GUI**
   (`~/code/process-mgmt-gui`, `src/backend/mgmt.ts`). The differences are
   instructive:
   - **It's matrix-driven, not set-driven.** `computeUnknowns` runs a
     _throwaway_ solve (`mainSolve`) just to obtain `lav.augmented_matrix`,
     then walks each item _row_ and counts signed entries: `producers` (`> 0`)
     and `consumers` (`< 0`) across the process columns, declared slacks, and
     the requirement column. proc-rs instead reasons over set membership of
     items in inputs/outputs.

   - **It's direction-aware.** Because the TS solver uses _signed_ slacks
     (import `+1` / export `−1`, see #1), the GUI must classify each dangling
     item as specifically `import` or `export`:
     `onlyConsumed (consumers>0, producers==0) → import`;
     `producedButNotConsumed (consumers==0, producers>0) → export`; plus a
     special case where an item that is _wanted_ but has only the requirement
     column as its "producer" (no recipe makes it) → `import`. proc-rs sidesteps
     all of this by using one unsigned slack and letting the sign fall out of
     the solve.

   - **It's an interactive hint loop, not fire-and-forget.**
     `computeUnknowns` → `applyHints` → `updateInputsWithHints` turns the
     detected items into editable requirement "lines" (op `auto`) that the user
     can override, then feeds the confirmed choices back into a _second_ solve.
     `applyHints` also adds polish proc-rs has no analog for: it lists exports
     before imports, and if there are no explicit requirements at all it
     promotes the first dangling export to a `produce` goal (amount 1) — i.e.
     "you added recipes but no target, so assume the dangling output is the
     thing you want." This matches the README's "needs better hints" UX note.

   Net: proc-rs bakes a simpler, automatic, single-bucket squaring into the
   solver/CLI; process-mgmt keeps the core solver minimal and pushes a richer,
   direction-aware, user-correctable squaring step up into the GUI. Neither the
   `process-mgmt` library on its own nor a non-GUI caller gets auto-squaring for
   free.

3. **The requirements column is excluded from pivoting.** process-mgmt calls
   `reduce_matrix(m, -1)`: the `column_slice = -1` makes the `lead` pointer
   stop _before_ the last column, so RREF never pivots on the RHS — it stays a
   pure result column. **proc-rs runs Gauss–Jordan over the entire augmented
   matrix, including the requirement column.** For a consistent square system
   both give the same answer. For an _inconsistent_ one, pivoting on the RHS
   (proc-rs) can manufacture a spurious `[0 … 0 | 1]` pivot row and silently
   corrupt the readout, whereas process-mgmt's exclusion keeps the RHS clean.
   Neither _detects_ inconsistency, but process-mgmt's augmented-matrix
   handling is the more textbook-correct of the two — a cheap robustness
   improvement worth porting to proc-rs.

4. **Pivot selection: first-nonzero vs partial pivoting.** process-mgmt uses
   the classic Rosetta-Code RREF — scan down for the first _exactly_ non-zero
   entry (`while (m1.get(i, lead) === 0)`). proc-rs uses **partial pivoting**
   (largest-magnitude entry, `find_row_with_max_magnitude`), which is
   numerically more stable. proc-rs is better here.

5. **Floating-point hygiene.** process-mgmt scrubs any `|x| < 1e-12` to exactly
   `0` after _every_ row replacement (`replace_row`), which keeps its exact
   `=== 0` pivot test viable. proc-rs never rewrites intermediate values; it
   only applies a `1e-10` tolerance at decision points (pivot-is-zero, net-zero
   classification). Two different philosophies — clean-the-data vs
   tolerate-at-comparisons.

6. **Catalysts / unmodifiable stacks are NOT modelled.** proc-rs has
   `inputs_unmod` / `outputs_unmod` plus separate input and output multipliers,
   so productivity bonuses correctly skip catalysts (FACTORIO.md complication
   #3). process-mgmt's `Factory` only has `duration_modifier` and
   `output_modifier`, and `Factory.update_process` multiplies _all_ outputs
   uniformly with no input multiplier and no unmodifiable concept. **The TS
   version cannot represent catalysts correctly.** proc-rs is strictly more
   expressive on the modifier/productivity model.

7. **Architecture: visitor pipeline vs single calculator.** process-mgmt is
   built as a chain of visitors over a `ProcessChain`
   (`filter_for_output` → `RateVisitor` → `ProcessCountVisitor` →
   `LinearAlgebra` → `RateGraphRenderer`), composed with `.accept()`. proc-rs
   collapses this into one `Calculator::generate` plus direct method calls, and
   pushes process selection out to the caller/CLI. The visitor split is more
   modular but spreads the algorithm across several files and leans on mutating
   the chain (`rebuild_materials` is monkey-patched onto the chain by
   `ProcessCountVisitor`).

8. **Process-count readout is equally fragile in both.** Both assume the
   process columns become the leading pivots in order and read building counts
   positionally from the last column. (process-mgmt's
   `_calculate_process_counts` even filters columns on a _method reference_
   `c.is_process_column` rather than calling it — it works only because the
   import/export/req pseudo-columns lack that property.) Neither validates that
   the pivots actually landed on the process columns.

### 10.4 Things proc-rs could borrow

- Excluding the requirements column from pivoting (10.3 #3) — small change,
  strictly safer.
- The explicit `RateCalculator` worklist is a ready-made fast path / sanity
  cross-check for acyclic chains.

- The GUI's matrix-row-based import/export _classification_ (10.3 #2) is a
  nicer diagnostic than proc-rs's set difference: it can tell the user _why_ an
  item is dangling and _which direction_ it resolves, which is the basis for
  better "no solution / add an import here" hints — something proc-rs's README
  also wants.

### Things process-mgmt (the library, standalone) is missing relative to proc-rs

- Catalyst/unmodifiable modelling (10.3 #6).
- Automatic squaring — it exists only in `process-mgmt-gui`, not the core
  library or a plain CLI caller (10.3 #2).
- Numerically stable partial pivoting (10.3 #4).
