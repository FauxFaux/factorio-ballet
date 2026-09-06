# Suggesting cell groupings before layout

Working design notes based on [the CPU cell snapshot](cells/cpu.json). This is a proposal for
grouping and layout assistance, not an implementation of automatic splitting.

## Initial observations

- The nitrogen utility is compressed air, air separation, and oxygen disposal. It needs
  `ceil(4.09424) + ceil(1.25977) + ceil(0.76767) = 8` machines, no material inputs, and one nitrogen
  pipe output at 307.068/s. Disposal belongs inside the group.
- Wafer production needs 24.98959 machines for 300 electronics machines: approximately one to
  twelve. Wafers move at 205.71429/s, while their mono-silicon input moves at 17.49271/s. At 30
  items/s per belt, that is seven belts versus one. This is a strong reason to put wafer production
  beside electronics and transport mono-silicon over the longer distance.
- The snapshot imports silicon ingots; there is no ingot-making recipe to assign. Nitrogen feeds
  nitride and mono-silicon **seed** production; mono-silicon itself takes seeds and molten silicon.
- Grouping must consider both a small, understandable boundary and the cost of transporting
  materials inside the group. Merely minimizing edges cut would select the entire cell.
- A logical group, a repeated assembly module, a physical design column, and a separately solved
  `Cell` are distinct decisions. Suggestions should be inspectable before any of those changes.

All calculations here use the requested approximation: a machine occupies 3×3 tiles; a belt carries
30 items/s in a one-tile-wide strip; each distinct fluid uses one pipe strip regardless of rate.
Infinite fluid throughput is a planning assumption. Machines' service space and actual connection
geometry still need consideration during layout.

## What the snapshot suggests

Counts below are installed machines: round up each recipe separately, then sum. Keep the original
fractional counts for all rate calculations. Rounding up capacity does not create extra demand or
production; some machines will be idle for part of the time.

| Candidate group              | Recipes                                 | Machines | Material inputs → outputs                                   |   Boundary strips, in + out |
| ---------------------------- | --------------------------------------- | -------: | ----------------------------------------------------------- | --------------------------: |
| Nitrogen utility             | Compressed air, separation, oxygen void |        8 | Nothing → nitrogen                                          |                  0 + 1 pipe |
| Mono-silicon                 | Melting, seeds, mono-silicon            |       17 | Ingots + nitrogen → mono-silicon                            |    1 belt + 1 pipe + 1 belt |
| Silicon nitride              | Powder, nitride                         |       17 | Ingots + nitrogen → nitride                                 |   1 belt + 1 pipe + 2 belts |
| Combined silicon preparation | Both preceding groups                   |       34 | Ingots + nitrogen → mono-silicon + nitride                  |  2 belts + 1 pipe + 3 belts |
| Electronics finishing        | Wafers, processing electronics          |      325 | Mono-silicon + nitride + platinum wire + acid → electronics | 9 belts + 1 pipe + 12 belts |

The full cell has 367 installed machines, or 3,303 tiles of machine area under the 3×3 assumption.
Nitrogen accounts for only 72 of those tiles. Finishing accounts for 2,925, so discovering a
finishing group is only the beginning of arranging it.

Two reasonable coarse alternatives are:

1. **Three groups:** nitrogen utility, combined silicon preparation, electronics finishing. This
   shares the ingot supply and nitrogen distribution inside silicon preparation.
2. **Four groups:** nitrogen utility, mono-silicon, nitride, electronics finishing. Each silicon
   branch has one output and 17 machines, making the individual groups easier to place. Nitrogen now
   branches to two groups.

The mono-silicon and nitride branches do not supply one another. Combining them is justified by
shared inputs and nearby placement, not by a direct recipe dependency. A generator that considers
only producer–consumer neighbours will miss this three-group alternative.

For the three-group alternative, nitrogen crosses between groups at 307.068/s on one pipe,
mono-silicon at 17.49271/s on one belt, and nitride at 34.28571/s on two belts. These are four
transport strips across three material connections. Nitrogen remains one output connection at the
utility boundary in the four-group alternative too; its two downstream branches have separate
lengths and destinations. Do not count two full-rate nitrogen exports from the utility.

### Why the wafer boundary is particularly valuable

| Material               | Total rate/s | Belts at 30/s | Role                    |
| ---------------------- | -----------: | ------------: | ----------------------- |
| Mono-silicon           |     17.49271 |             1 | Input to wafer making   |
| Wafers                 |    205.71429 |             7 | Input to electronics    |
| Silicon nitride        |     34.28571 |             2 | Other electronics input |
| Platinum wire          |    171.42857 |             6 | Other electronics input |
| Processing electronics |          336 |            12 | Final export            |

Moving the wafer recipe downstream replaces a long seven-strip connection with a long one-strip
connection. For the same route length `D`, this changes that corridor from `7D` to `D` tiles. It
saves `6D` there, before accounting for changes to the local distribution routes and placement. The
205.71429/s wafer flow still exists and needs short routes within finishing.

The wafer recipe has one input and one output. Electronics has four inputs and one output; the
combined group's interface still includes nitride, platinum, and acid. Grouping wafers does not
remove those supplies or the twelve-belt final export.

### Repeated finishing modules

The exact solved machine ratio is `1 wafer : 12.005 electronics`. A natural physical template is one
wafer machine beside twelve electronics machines, repeated 25 times. Each copy allocates
`24.98958767 / 25 = 0.99958351` wafer-machine workload and twelve electronics machines. One
installed wafer machine is about 99.958% utilized, and the whole arrangement still installs 25 wafer
machines plus 300 electronics machines.

| One module          |   Rate/s | Connection   |
| ------------------- | -------: | ------------ |
| Mono-silicon input  |  0.69971 | 1 belt       |
| Nitride input       |  1.37143 | 1 belt       |
| Platinum wire input |  6.85714 | 1 belt       |
| Sulfuric acid input | 13.71429 | 1 pipe       |
| Electronics output  |    13.44 | 1 belt       |
| Wafers, internal    |  8.22857 | 1 short belt |

That is 13 machines and 117 tiles of machine area per copy, before belts, inserters, pipes, beacons,
and gaps. It is a capacity-compatible template, not yet a proven floor plan. Compare it with larger
copies, such as two wafer machines and 24 electronics machines, including a smaller remainder module
when necessary.

Twenty-five independent output branches require 25 belts locally even though their combined output
fits on twelve trunk belts. The same effect applies to inputs. Cost the branch lengths, merges, and
trunks separately. Repetition can reduce wafer travel while increasing distribution overhead; a
ratio alone cannot choose the best module size.

Keep these copies as a repeated layout inside finishing initially. Creating 25 independently
editable solver cells would add considerable bookkeeping to what is one repeated design.

## Represent the problem at two scales

Start from the current solved cell, with a node for each recipe entry and a material network joining
its producers and consumers. Include explicit outside sources and destinations for cell imports,
exports, and unresolved surplus or demand. Resource nodes are useful here: nitrogen has one producer
and two consumers, and ingots have an outside producer and two consumers. A plain unweighted recipe
graph loses the rates, transport type, and shared distribution.

Each recipe node needs its resolved machine, loadout, fractional workload, installed capacity, and
gross input/output rates. Keep entry identity separate from recipe identity in the proposed model:
later allocation may put part of the same recipe's workload in several layout groups.

There are then two operations:

- **Group whole recipe entries:** identify utilities, chains, and adjacent production stages. This
  is a small search over ten nodes in this example.
- **Allocate workload among repeated modules:** split the 300 electronics and 24.98959 wafer
  workloads into co-located copies. Grouping whole recipes alone cannot express this locality.

A hierarchy supports both: the cell contains the utility, silicon preparation, and finishing;
finishing contains repeated modules. A design column is a place to arrange these, not their
identity. A group can occupy several columns; a column can contain several small groups.

### Flows are obligations, not inferred pairwise allocations

For this snapshot every internally produced material has a unique producer, so assigning its output
to the consumer demands is straightforward. In general there may be several producers and consumers.
Preserve their supply/demand amounts and choose allocations explicitly, initially preferring local
consumption and then short inter-group routes. A transportation-flow subproblem can allocate a fixed
material once approximate group positions exist. Integer belt counts make the complete cost
discontinuous; a linear distance allocation is a starting approximation to refine, not an exact
solution to that cost.

Do not create a complete producer–consumer graph with the full rate on every edge. It duplicates
production and grossly overprices shared materials. Likewise, the JSON `ratio` is the sum of
counterpart machine counts relative to this row, not a flow allocation or a general template ratio.
Derive templates from assigned rates and per-machine capacity.

Gross flows remain important for catalysts and returned tools. A zero net resource balance does not
mean zero physical movement. A group's net balance gives its minimum outside requirement under local
matching; actual boundary traffic must follow the chosen allocation. A forced route which imports
and exports the same resource needs both directions recorded. Fluid temperature compatibility must
also be preserved rather than treating every flow with one resource id as interchangeable.

## Generate candidates, then evaluate arrangements

### Candidate generation

Use several simple generators whose suggestions can explain themselves:

1. **Small utility closures.** Grow backwards from an exported resource through its producers,
   adding byproduct consumers where this closes an extra boundary. Include sinks and no-input
   sources. Prefer few input resources, one output, and a small installed footprint. This finds
   compressed air + separation + oxygen void without recipe-name rules.
2. **Costly handoffs.** Seed a producer–consumer pair when its shared item connection is wide, then
   grow the group while its interface and size remain useful. Wafers + electronics is the strongest
   example. Also compare moving a transformation towards its supplier or consumer by evaluating the
   boundary on either side: expansion favours downstream placement, compression often favours
   upstream placement. Include all the recipe's other inputs and outputs.
3. **Chains and branches.** Grow connected subsets around a terminal output, stopping at cheap cuts.
   This proposes melting + seeds + mono-silicon and powder + nitride. Also propose merges of groups
   sharing outside supplies, so combined silicon preparation is considered.
4. **Cycles.** Identify strongly connected components and seed candidates containing their
   recirculation. Keeping these together is a preference, not an absolute rule: a very large cycle
   may need splitting, with every return connection and any startup requirement exposed.
5. **Repeated modules.** After a strong co-location pair or group is found, enumerate small integer
   capacities around its solved ratios. For each capacity vector solve or allocate feasible
   workloads, count the copies and remainder, and evaluate rounding and distribution. Retain several
   sizes rather than choosing the closest ratio mechanically.

For ten entries, enumerate all `2^10 - 2 = 1,022` nonempty proper subsets as a small reference
search. Cache each subset's balance, rounded machine count, boundary widths, and connectivity. This
catches candidates that greedy growth misses. A read-only enumeration of this snapshot found exactly
one multi-recipe subset with no inputs, one output, and at most 32 installed machines: the
eight-machine nitrogen utility. The threshold is an illustrative utility filter, not a universal
limit on groups.

For larger cells, use those seeds plus bounded beam search or greedy merges, retaining multiple
alternatives. Follow with single-entry moves, swaps, and split/merge refinements. Canonicalize
membership and use stable tie-breaking so reordering recipe rows does not change suggestions. Keep
pinned groups fixed. Use a search budget and return the best candidates found with an honest
heuristic status.

Candidates overlap: wafer + electronics conflicts with a candidate containing every silicon recipe
including wafers. Select a compatible partition before showing an overall plan. Every workload must
appear exactly once across its groups, except where explicit fractional allocations sum to the
original workload.

For small cells, a subset dynamic program can choose compatible groups under an additive group
score: choose a candidate containing the first remaining entry, then recurse on the remainder.
Retain several partitions for geometric evaluation. That score can price interface endpoints, size
preferences, and complexity, but shared routes and positions are not additive. A minimum under that
proxy is not a globally optimal layout. Always include the unchanged cell as a baseline.

### Boundary and footprint measures

Let `q` be the assigned positive rate of material `r` on a particular route segment. Its width is:

```text
width(r, q) = 0                         when q is effectively zero
              ceil(q / beltCapacity)   for an item
              1                        for a fluid

machineArea(group) = sum(installedCount(recipe) × machineWidth × machineHeight)
routeArea(segment) = width(material, segmentRate) × segmentLength
```

Use a relative/absolute tolerance before comparisons and ceilings so floating-point noise at 30/s
does not create a second belt. Keep rate precision until rendering. Sum widths per distinct material
and direction: three products each moving 10/s occupy three strips under this model, even though
their sum is one belt's capacity. Two lanes sharing different items would be a separate transport
policy, outside the requested approximation.

Report distinct material counts as well as widths. The cell contract's 1–8 understandable resources
is a useful preference; electronics finishing has five distinct boundary resources but 22 strips.
One number cannot represent both mental complexity and physical width.

Do not treat an unlimited-throughput pipe as free. It occupies space, has length, connects to
specific machine sides, and may branch. Oxygen and compressed air are internal pipe networks in the
nitrogen utility and need layout space even though neither crosses its boundary.

Use resolved `Machine.size` from the app when available. The JSON snapshot omits machine ids,
loadouts, and dimensions, so the numbers above use only the requested 3×3 approximation. Never infer
actual machine sizes from its counts.

### Avoid a score which always chooses one giant cell

Minimizing cut edges or cut transport width alone makes putting everything together the easy winner.
Enforcing equally sized groups is also a poor match: an eight-machine utility should not be inflated
to match a 325-machine finishing stage.

Compare candidates on several explicit measures:

- Boundary resource count and belt/pipe widths, with separate input/output summaries.
- Estimated total transport area, including internal routing, distribution branches, outside
  imports/exports, and return flows.
- Largest group dimensions/area, fit in the user's available space, and reserved service space.
- Additional machines caused by dividing workloads, plus underutilized capacity.
- Number of distinct group designs, repeat count, and complexity of each interface.
- Congestion, crossings, detours, and unrouteable ports from the coarse layout.

Keep a small Pareto set: discard a plan only when another is no worse on the selected measures and
better on at least one. Offer named preferences such as “simpler interfaces”, “shorter transport”,
and “smaller modules”. They select among tradeoffs rather than exposing arbitrary algorithm weights.
A requested footprint or maximum group size can be a hard constraint; otherwise size is a
preference, and the unsplit alternative remains valid.

A possible internal ranking for a chosen preference is:

```text
score = estimatedRouteArea
      + sizePenalty + interfacePenalty + extraMachinePenalty
      + distinctDesignPenalty + congestionPenalty
```

Convert penalties to documented comparable units or normalize them against the unchanged plan;
calibrate on example cells. Show the underlying measurements and reasons to the user, not a spurious
“87% optimal” score. A single proposed extraction can be valuable even when there is no confident
recommendation for the remaining cell.

### A cheap geometric second pass

For the best few partitions, try several rectangle shapes and input/output side assignments for each
group, using machine area plus configurable service allowance. Place them on a coarse grid with flow
direction as a starting order; try moving and rotating groups. Include fixed outside ports when
supplied. Otherwise compare several outside-port placements and label the estimate as dependent on
those assumptions.

Estimate routes with Manhattan paths, then reserve corridor width on a coarse occupancy grid.
Allocate each segment's rate: a shared trunk carries the total demand downstream, while each branch
carries only its own demand. Charge a shared segment once. Distinct fluids may not merge, and
distinct item strips may not overlap without an explicitly modelled crossing. Test whether the
required widths fit the chosen sides and corridor space; reroute or reject failed candidates.

Internal routing must receive the same treatment, even if initially represented by templates and
estimated lengths. Otherwise merging groups falsely makes their transport cost disappear. Also
include the costs of external platinum and electronics transport; in this example they are large
enough to influence the orientation of finishing.

The first pass need not place every assembler. It should identify obvious congestion and return
plausible envelopes and ports for later detailed placement. Missing inserter throughput, fluidbox
assignment, beacon coverage, or crossing rules limit confidence in a buildable result. Preserve the
solved machine effects when comparing candidates, and flag any layout that cannot supply the assumed
beacons rather than silently changing its rates.

## UI proposals

### Start with two specific suggestions

Place a “Suggest groups” action beside the cell's design controls. Its first result can be two
compact, inspectable cards:

> **Nitrogen supply · 8 machines**  
> No material inputs · nitrogen 307.07/s · 1 pipe out  
> Includes oxygen disposal. A small utility that can sit beside the main production.  
> Preview group · Keep together

> **Make wafers beside electronics**  
> Carry mono-silicon on 1 belt instead of wafers on 7 over the longer route.  
> Try 25 modules of 1 wafer machine + 12 electronics machines.  
> Preview modules · Compare sizes

Previewing a suggestion highlights its recipe rows and draws its boundary input/output list. Show
installed counts beside fractional workloads in the detail, and give every material its rate and
required strip count. Explain which internal connections become local. This should work with
keyboard focus and selection as well as hover; colour is additional information.

For broader exploration, offer three-group and four-group alternatives with the same metrics,
including the unchanged layout. A small group graph can show nitrogen's branch and the two silicon
outputs; line labels should state both material and width. Avoid a giant graph of all 367 machines
at this stage.

### Use the design surface to make the proposal tangible

`src/components/design/design-column.tsx` currently draws only a column heading on the grid. It
could show a provisional group rectangle with a name, machine total, boundary port labels, and a “25
×” repeat badge for finishing modules. Selecting the rectangle opens the relevant recipes and
routing assumptions. A toggle between “Groups” and “Machines” would let the same surface gain detail
later without immediately rendering every entity.

The parent `CellDesign` should own the proposal selection and assignments. Pass resolved groups,
selected state, and callbacks down to columns; keep search and scoring outside rendering code.
`CellBox` already has the cell and solution but currently passes only `design` and `setDesign` to
`CellDesign`, so the new preview needs an explicit data path for the solution and choices.

Useful controls after preview are “Keep together”, “Keep apart”, moving an entry to another group,
changing a module's repeat size, and naming a group. Provide menu/keyboard equivalents for dragging.
Show the resulting interface and extra capacity immediately. Accepted constraints should survive
recomputation; machine, module, belt, or rate changes should mark estimates stale and recompute them
without silently replacing an accepted arrangement.

Keep **Group in this cell**, **Arrange in columns**, and **Split into cells** as separately named
actions. Preview is transient and cancellable. Applying an arrangement is undoable. An actual split
needs a review of all resulting cells, their scale, and their material connections.

On narrow screens, stack suggestion cards and interface summaries. Follow `STYLING.md` for
responsive flow and rem-based sizing. In particular, group identity and repeat count must not depend
on viewport width. `CellDesign` currently adds blank persisted columns as its surface widens; do not
use that mechanism to infer groups or create production copies.

## Integration and the meaning of an actual split

The existing code provides most inputs for analysis:

- `src/solve/index.ts`: `Solution.counts` and gross `inputRates`/`outputRates`; multiply each
  per-machine rate by the solved count exactly once. The JSON snapshot already contains totals.
- `src/components/cell/connection-calc.ts`: useful current presentation of counterpart recipes, but
  its counterpart machine totals are not allocated transport edges.
- `src/cell.ts`: `cellInterface` classifies resources using recipe-local netting and set membership.
  Group scoring needs quantitative allocated boundary flows, so cannot use that classification
  alone.
- `src/data/index.ts` and `src/types.ts`: the chosen belt capacity and resolved machine sizes. The
  current connections display has a 1,200/s fluid comparison convention; the requested
  unlimited-throughput grouping model should explicitly use one pipe per active fluid network.
- `src/design.ts`: physical entities and columns, without logical groups or workload allocations.

Proposed pure analysis functions could live under `src/split/`, with a solved-flow adapter,
candidate generation, group evaluation, partition search, and later a coarse routing evaluator. No
additional production solver is needed to score subsets at the existing solution's rates.

A proposal needs member entry references, optional allocated workloads, computed boundary flows,
installed counts, metrics, explanation reasons, and a fingerprint of the source solution and
transport assumptions. A selected plan additionally needs group ids, repetition, placement
constraints, and eventual assignments to columns. These are proposed concepts, not current APIs. Do
not serialize the full search cache or derived rates. Persist accepted membership, allocation
intent, and constraints, then derive the preview again. Extend packing and URL compatibility
handling deliberately when accepted grouping state is introduced.

Moving entries into new `Cell` objects is not sufficient to preserve the factory. Each current cell
is solved independently, and a newly isolated unpinned cell can be seeded at one machine. There is
no persisted cross-cell flow constraint to keep nitrogen production aligned with both consumers.
Keeping only the original pin on electronics therefore changes the other cells' scale.

An initial “Split into cells” implementation can preserve the reviewed snapshot by copying the
resolved machine/loadout choices and pinning **all** child workloads to their original solved
counts. Preserve original user choices where explicit, and make newly frozen auto choices/counts
visible. Verify every child's external rates and that the sum of all children retains the parent's
balance. This creates fixed snapshots: changing demand in one child will not resize the others.
State that consequence before applying, and provide undo.

For ongoing coupled editing, introduce cross-cell material demands or a parent plan that solves the
whole recipe system and allocates its result to child groups. Prefer that parent solution for layout
grouping now; actual independent cells can follow once their scale semantics are defined. The
exported CPU JSON is enough to analyze the snapshot, but lacks the choices needed to reconstruct
equivalent editable cells on its own.

When a cell already has placed entities, any split must explicitly map them and their routes to the
resulting groups or flag the unresolved assignments. Do not discard an existing design or guess
ownership of a belt merely because a recipe moved.

## A unified solver, with optional explicit connections

The preferred direction is one solver model which can solve either a whole connected plan or a
selected cell with boundary conditions. Start with global balancing and derived cell interfaces;
leave room for explicit material connections where they express a supply decision. These are
complementary capabilities. We do not need to require the user to wire every cell before the CPU
example can remain balanced after splitting.

There are three separate questions:

1. **Production:** how much work does each recipe perform?
2. **Supply allocation:** which producer supplies each consumer, and at what rate?
3. **Physical routing:** where do those allocated materials travel?

A global material balance often answers the first without uniquely answering the second. The layout
eventually needs all three. An automatically inferred connection should therefore be shown as an
allocation proposal, not as a supply commitment the user already made.

### Start by solving across cell boundaries

For the CPU example, flatten the entries from its nitrogen, silicon, and finishing cells into one
solve, preserving the pin of 300 electronics machines. Balance every internal material across those
entries together. Project the resulting counts and rates back onto their owning cells. Nitrogen
production still covers both demands, and moving wafer entries between cells does not change their
solved counts. No cell-to-cell references are necessary for this result.

The current `Solver.solve(rows)` is already independent of `Cell`. The main architectural change is
to compile rows at plan scope, retain a mapping from each row to its owning cell/entry, and render
projections of one solution. `CellBox` would receive its projected result rather than independently
calling `solveCell` for a globally managed cell. Local and global solvers must not compete to write
answers for the same entries.

In this mode a cell's quantitative inputs and outputs are derived from its solved work and the
chosen allocation. A group with net nitrogen demand displays an input even though nitrogen is
balanced globally. Show whether each flow is supplied by another cell, imported from outside the
plan, or still unallocated. Keep gross transit/return flows where the allocation requires them; net
balances alone cannot describe every interface.

This gives a useful invariant: moving an entry between organizational cells, without changing its
coefficients or any constraints, must leave the global production solution unchanged. Changing
supply permissions, a local contract, or layout capacity is a different operation and can
legitimately change the solution.

### A global solve needs a declared scope

“Global” should mean one production plan, not automatically every cell visible on the page. Two
alternative electronics designs should not accidentally supply each other just because they use the
same resource ids. The page may contain one coupled plan alongside independent cells or experiments.
Preserve the existing independent behavior when loading an old collection of cells unless the user
chooses to connect them into a plan.

Represent solve scope separately from layout membership. A plan can initially be a set of cell ids
whose compatible materials share supply automatically. An independent cell is a scope containing one
cell. Later, a shared resource pool can identify which cells are allowed to exchange a resource
within a scope. Fluid temperature compatibility remains a constraint.

Disconnected parts of a plan need independent scale constraints. The current solver seeds only the
first row when no counts are pinned; flattening several unrelated cells is not enough to give each
one a meaningful scale. Detect unconstrained components and report what target or pin is missing, or
explicitly carry forward their previous local scale. Do not seed every child cell after splitting a
connected factory: those extra equations would usually overconstrain it.

### When display-only interfaces are sufficient

| Situation                                                  | Global balance with derived interfaces                                      | Additional intent needed                                               |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| One nitrogen utility supplies both silicon branches        | Determines the shared production rate; consumer demands determine the split | None for production; route branches later                              |
| Two cells produce the same material with spare freedom     | Determines total supply needed, possibly not each producer's workload       | Pin a workload, choose a supplier, or state an optimization preference |
| A consumer must use a particular source                    | Global totals cannot enforce that choice                                    | A source restriction or dedicated material pool                        |
| An existing factory has a fixed supply limit               | A count pin fixes work, not a maximum available capacity                    | A capacity constraint and a policy for any shortfall                   |
| A cell imports a material which is also produced elsewhere | Automatically closing the resource can erase the intended import            | An explicit outside-import allowance or requirement                    |
| Two designs are being compared                             | Sharing supply makes the comparison misleading                              | Separate solve scopes                                                  |

Thus the first release can have derived interfaces, but the model should distinguish those results
from editable boundary requirements. “Show inputs” is a view; “take nitrogen only from Air supply”
or “export 336 electronics/s” changes the problem being solved.

### Explicit references should constrain supply, not copy recipes

An explicit link can say “this cell takes nitrogen from that cell”. It references stable cell ids
and a material, with optional rate/capacity constraints. It does not embed a second copy of the
supplier or recursively solve it once per consumer. There is one nitrogen utility workload even when
two cells refer to it. References may form cycles; solve the resulting equations simultaneously
rather than requiring a dependency tree.

Useful supply choices are:

- **Auto from this plan:** allocate among permitted suppliers, and expose ambiguity if neither
  constraints nor an explicit selection policy determine their workloads.
- **Only from a named cell or pool:** a hard source restriction.
- **Prefer a named cell:** a soft allocation preference, with any fallback made visible.
- **From outside the plan:** an explicitly allowed or fixed external supply.

An “allowed supplier” link alone does not necessarily determine a rate; an “only supplier” link also
excludes other sources. Make that distinction clear. In an explicit supply mode, omitted routes must
not be silently recreated by the automatic resource pool, or a hard source choice has no effect. A
preference can intentionally allow fallback through that pool.

The UI could make a derived input's source label editable: `Nitrogen · Auto (Air supply)` becomes
`Nitrogen · Only Air supply`. Keep the automatically solved rate as an answer unless the user adds a
rate target or limit. An unresolved input should remain visible with an actionable note. There
should be no obligation to fill out source pickers for the unambiguous CPU example.

Links should live in the parent plan, or in one other authoritative collection, so incoming and
outgoing lists are views of the same records. Use stable ids rather than array positions or cell
names. Removing a referenced cell must expose a broken commitment or remove it through an explicit
edit; it must not quietly attach the consumer to whichever cell occupies that index.

### One constraint model can express both approaches

Let `x[j]` be the fractional workload of recipe entry `j`, and `a[r,j]` its net rate of material `r`
per machine. For a cell `c`, define its net production:

```text
net[c,r] = sum(a[r,j] × x[j] for entries j in c)

net[c,r] + incoming[c,r] + outsideImport[c,r]
         - outgoing[c,r] - outsideExport[c,r] = 0
```

With unrestricted sharing, eliminate the unknown inter-cell transfers and sum this equation over the
whole scope. Each internal transfer cancels, giving the familiar global balance. Cell boundaries are
then a projection plus a subsequent supply allocation. With explicit connections, introduce
nonnegative transfer variables `f[source,destination,material]` only on permitted routes and retain
the cell equations. The same `f` contributes to its source's outgoing total and its destination's
incoming total, so shared supply cannot be counted twice.

External imports/exports are permitted only by the scope's boundary policy. Initially, the current
convention of treating one-sided materials as open edges can be a convenience default. An internal
material normally has zero outside exchange unless explicitly opened. Do not add unrestricted
import/export variables for every material: that would let the solver bypass the factory or absorb
conflicting pins by inventing outside supply and disposal. Avoid meaningless simultaneous imports
and exports unless they represent an intentional transit arrangement.

Derived rates, equality targets, fixed workloads, available capacities, and preferences need
distinct representations. In particular, the existing `CellEntry.count` is an equality pin. “I have
eight machines available” means an upper bound, not a requirement to run eight machines
continuously. Machine placement still rounds capacity; production stays continuous.

The present RREF solver covers uniquely determined equality systems. It can support the simple
flattened CPU solve, but nonnegative allocation choices, capacity inequalities, and objectives need
a constrained feasibility/optimization backend, or honest diagnostics when unsupported. A linear
program is a possible next backend for production and transfer allocation; integer machine counts
and belt-width ceilings remain a separate layout/capacity problem initially. Keep one problem
representation with explicit backend capabilities rather than allowing a fallback to ignore
constraints it cannot represent.

Production can be unique while supplier allocation is ambiguous. Report these statuses separately;
“machine counts solved” need not imply “connections chosen”. An explicit link may resolve an
ambiguity, but it can also create an infeasible plan, and the diagnostic should point to the
involved cell, resource, and constraint.

### Preserve local solving through boundary conditions

A local solve can use the same compiler and backend with a smaller scope. What makes it local is how
the outside world is represented, not a different balancing algorithm. Keep the following options
open without deciding that every one needs a permanent UI mode:

| Local operation                             | Boundary treatment                                                                                         | Effect on the surrounding plan                              |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Inspect a cell                              | Project the global solution                                                                                | None; no additional solve                                   |
| Design a cell independently                 | Explicit local imports/exports and a local pin or target; optionally assume permitted inputs are unlimited | None until attached to a plan                               |
| Try a change while holding neighbours fixed | Fix every allocated boundary transfer to the current global result                                         | Preview only; neighbours retain their work                  |
| Redesign behind a contract                  | Solve against declared output requirements, input allowances, and capacities                               | Must revalidate globally before accepting changed transfers |

“Hold the boundary fixed” is particularly useful for trying different machines or internal recipes
while preserving what the rest of the factory receives and provides. Start by freezing all boundary
transfers, including byproducts and return flows. This is deliberately strict and can make a
productivity change infeasible because it changes the required inputs. A later variant can hold
output deliveries fixed while treating the available inputs as limits; that needs inequality support
and may release some supply back to the surrounding plan.

A local sandbox may assume unlimited acid or nitrogen only when those inputs are declared open.
Label that assumption. A successful sandbox solution is not evidence that the parent has enough
supply. On applying a local edit, recompile and solve the global problem, then show changed
neighbouring workloads or any unmet constraints. Preserve user pins and supply restrictions. Do not
write the local answer into the global solution as though the neighbours had agreed.

Merely freezing boundary transfers does not detach the cell; it creates a conditional local problem.
Conversely, making a cell independent removes its participation in shared supply and requires the
parent to recheck every affected consumer. Those should be distinct actions.

This also avoids iterating independent cell solvers until their rates happen to converge. Cross-cell
cycles and shared byproducts belong in the simultaneous global solve. Local previews are conditional
answers, not an alternative propagation algorithm for the full factory.

### Hierarchical solving can come later

A stable cell design can eventually expose a contract or a scalable production profile to its
parent. A fixed-ratio profile has one scale variable: its internal workloads and boundary rates all
multiply by that scale. This suits a repeated wafer/electronics module whose ratio and loadouts are
fixed. Store one template and explicit instances/repetition; referencing a supplier must never
implicitly instantiate another copy of it.

Not every cell is a one-variable profile. Alternative recipes, independently adjustable outputs,
capacities, and user pins may leave several degrees of freedom. A locally underdetermined cell can
still become determined by the parent's demands. Do not force a local seed just to turn it into a
profile, or export one arbitrary locally solved ratio as its only possible behavior.

Flattening entry-level equations across cells is the simplest reliable first implementation. Later,
eliminating internal variables can produce a smaller boundary constraint system while retaining the
cell's actual feasible behavior. That is an optimization of the unified model, not a prerequisite
for grouping or a reason to commit now to opaque independently solved cells.

### A staged path which keeps the options open

1. Introduce explicit plan membership and stable cell/entry identity. Compile one production problem
   for each solve scope, with diagnostics mapped back to their originating rows.
2. Globally solve the flattened CPU entries and derive per-cell interfaces. Splitting or merging
   organizational cells preserves rates without freezing every child count. This is preferable to
   the snapshot workaround above once global solving is available.
3. Add local sandbox and fixed-boundary previews using the same problem representation. Start with
   equality conditions supported by the current backend.
4. Add editable boundary targets and supplier restrictions, exposing transfer variables where
   required. Add a suitable backend when capacities or allocation objectives are introduced.
5. Add reusable contracts/profiles if they help repetition, independent editing, or solver size.

Checks specific to this direction should cover regrouping invariance, one shared supplier serving
two consumers, isolated plans using identical materials, explicit source restrictions which cannot
be bypassed through auto supply, intentional imports of internally produced materials, cross-cell
cycles, unique production with ambiguous allocation, and missing scale constraints. Also check that
a local fixed-boundary preview leaves neighbours unchanged, that applying a changed boundary
triggers global validation, and that reordering/removing cells preserves or clearly breaks stable
references. Keep serialization changes and existing independent-cell behavior part of the migration
tests.

## Suggested delivery and checks

1. Add pure subset analysis and explainable suggestions, using the existing solved cell. Show
   boundary tables and highlighted members, with no persisted changes or solver changes.
2. Add compatible partition previews, user membership constraints, and repeated workload templates.
   Compare the three/four-group CPU alternatives and several finishing module sizes.
3. Add coarse envelopes and routing, then translate accepted arrangements into design columns and
   detailed entities. Use those routes to refine rankings.
4. Add actual child-cell creation with explicit snapshot or coupled-solve semantics, URL
   persistence, and undo.

Behavioral regression cases for implementation:

- This snapshot finds the eight-machine nitrogen utility, including oxygen disposal, with no input
  and exactly one output pipe; balances near `1e-13` produce no phantom interfaces.
- Wafer relocation exposes one mono-silicon belt instead of seven wafer belts; all other finishing
  inputs and the twelve-belt output remain in its boundary.
- Twenty-five 1:12 templates preserve every solved rate and install 325 finishing machines; local
  branch widths and shared trunk widths are counted separately.
- Three 10/s products need three strips; 200/s needs seven; rates on either side of a belt threshold
  round correctly. Changing belt tier reranks using its actual capacity.
- Multiple suppliers do not duplicate a consumer's demand; nitrogen fan-out conserves the producer's
  rate; catalysts retain their gross internal transport; cycles retain return paths.
- Temperature-incompatible flows do not disappear through netting. Partial or conflicting solutions
  expose uncertainty and cannot claim a balanced, ready-to-split plan. Check solver problem notes
  and residuals as well as `complete`, which only says every row has a count.
- Candidate generation is stable under row reorder, accepted constraints hold, overlapping
  suggestions cannot duplicate work, and every allocation sums to its source workload.
- A whole-cell candidate cannot erase internal route cost. A smaller interface can lose to an
  alternative when its internal detours, extra machines, or outside routes are worse.
- Preview/cancel leaves the cell intact; apply/undo and URL round trips preserve choices,
  constraints, designs, and active-cell selection; viewport resizing does not alter membership.

For these notes, the numerical tables and utility-subset result were calculated directly from the
working `docs/cells/cpu.json` with Node. No grouping UI or solver behavior is implemented here.
