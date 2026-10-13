# Splitting and connecting physical placements

`src/compute/placement-plan/index.ts` is the default whole-cell module maker. It uses HiGHS to
choose fractional workloads, supported stack capacities, and material connections jointly before 2D
placement. `CellBox` passes its modules and retained flow assignments to station connection and port
assignment; it must not allocate internal flows again after selecting the split.

This is the physical stack counterpart of the logical decomposition described in
[`../SPLIT.md`](../SPLIT.md). It does not create independently solved child cells or change the
recipe solution.

The [joint fractional MILP notes](PLACEMENT-MILP.md) record the original experiment and its scoring.
The command-line runner still accepts abstract footprint envelopes. Application planning uses the
same solver with exact supported integer stack sizes and real kernel ports instead.

## Default joint planner

`milp.ts` keeps workload and material-rate variables continuous. Each recipe's workloads sum to its
solved count; integer capacity never increases demand or production. Every active stack chooses an
exact size from `recipes.ts`'s validated repeat templates, including the advertised repeat step,
supported-copy limit, and maximum physical height. A pair repeat remains whole. Unsupported kernels
are explicitly estimated; an estimated singleton remainder costs 100 when validated alternatives
exist, so one extra building can be preferable to unvalidated geometry.

The original installed baseline is the sum of each positive recipe's `ceil(count - 1e-8)`. Extra
buildings are allowed, with a default allowance of six across the cell and a penalty of 30 each.
Validated physical geometry, ports, and repeat counts follow installed capacity; assigned
ingredient, product, and port rates follow fractional workload.

Each recipe gets enough optional slots for its largest supported stack plus one extra slot by
default. The score charges placements, material connections, belt trunks, fluid pipes, boundary
branches, per-material producer branches and consumer merges, and footprint area. Exclusive-output
pairs, exclusive-input pairs, and mutually exclusive pairs receive the rewards described in
`PLACEMENT-MILP.md`. Exclusivity covers every material on the relevant interface, including imports
and byproduct exports; it is not awarded for just one dedicated ingredient.

The model conserves gross rates, forbids self-supply within a stack, and fixes outside rates to the
cell's net imports and exports. The application supplies its declared boundary resource sets, so an
undeclared internal imbalance cannot become an allowed station connection. Cycles retain their gross
flows. After solving, the planner reconstructs the chosen templates, verifies emitted module flow
conservation, and retains the solver's chosen material assignments.

The default solve budget is one second, with an absolute objective tolerance of 0.01. A supported
baseline partition and its sparse flow assignment seed the model when they fit its slots. A
budget-limited feasible incumbent is still a usable plan. If no feasible incumbent exists, numerical
conservation fails, or the model exceeds 128 slots or 2,000 potential internal edges, the planner
retains the baseline and reports the reason. Baseline unresolved remainders remain explicit and can
only attach to declared stations.

Diagnostics identify HiGHS versus baseline planning, solve status, elapsed solver time, score lower
bound, remaining score gap, and fallback reason. These bounds cover the selected slot space and
topology/footprint objective; they do not prove an optimal routed 2D layout. Distance, crossings,
and physical corridor feasibility remain later layout responsibilities.

## Asynchronous application integration

`components/cell/placement-plan.ts` uses a dedicated module worker with a Vite-emitted HiGHS Wasm
asset. The runtime loads only for an open physical layout after kernel searches finish. Solving
never blocks the UI thread. A supported baseline is available immediately during loading/search.
Completed plans are cached by request value, including rates, counts, kernels, belt capacity, and
declared boundaries. Changing inputs or closing/unmounting a layout terminates obsolete work; stale
replies cannot replace the current plan. Worker errors preserve the baseline.

`test/compute/placement-milp.test.ts` runs the default planner against actual Space Age kernel
options and verifies fractional workload conservation, supported geometry, station connections, and
complete port attachment. It also checks pair-only odd remainders under soft and strict building
budgets, unresolved cells, estimated geometry, undeclared boundaries, and recipe ordering.
`test/placement-plan-hook.test.tsx` checks worker cancellation, stale replies, value caching,
deferred kernel readiness, and loading failures. The shared model's conservation and exclusivity
tests remain in `test/scripts/placement-milp.test.ts`.

## Legacy shortlist planner reference

`search.ts` exports `searchCellPlacements` for comparison and regression coverage. The following
sections describe that previous planner, including its old diagnostics, constraints, and measured
timings. They do not describe the default HiGHS planner. The browser benchmark runner now calls the
default planner; the historical measurements below have not been repeated for HiGHS.

## Capacity and workload

For every positive solved recipe, the installed building budget is `max(1, ceil(count - 1e-8))`.
Every candidate redistributes exactly that budget, never adding buildings.
`FactoryModule.machineCount` and `copies` describe physical capacity and geometry.
`FactoryModule.workload` is the fractional assigned work. All module ingredient, product, and port
rates follow workload, not installed capacity. Workloads sum to the solved count and remain within
each module's installed capacity, with floating-point tolerance.

Validated kernel options supply supported repeat sizes, dimensions, ports, and maximum stack
capacities. The planner picks the smallest supported footprint for each integer stack size and can
mix kernel families within a recipe. A pair repeat stays whole. If only pair kernels exist for an
odd building budget, the singleton remainder is explicitly estimated rather than silently installing
another building. Pending or unsupported recipes also use estimated footprints, just as they did
before. An estimated footprint is not a validated buildable kernel.

The recipe-only kernel previews pack supported repeats; they are not the whole-cell placement plan.
The plan can use different splits and different kernel families.

## Whole-cell combination search

`candidates.ts` creates an independent shortlist for each recipe. It includes the smallest supported
partition, a balanced partition, alternative assignments of spare capacity, dedicated feeds derived
from consumer demand, and the first feasible powers-of-two expansions. Powers are halved from the
largest block, preserving an odd singleton remainder. For nine buildings the power sequence is:

```text
8 + 1
4 + 4 + 1
4 + 2 + 2 + 1
2 + 2 + 2 + 2 + 1
```

These proposed pieces are converted to supported kernel repeats without adding buildings. A
singleton recipe has exactly one candidate, including when its workload is fractional. Each
shortlist defaults to at most six candidates, including workload alternatives. The whole-cell
placement allowance remains twice the fewest supported placements.

`search.ts` searches the Cartesian product of the shortlists. It does not require an individual
recipe change to improve the plan before combining it with other recipe changes. The default budget
is one million complete candidate evaluations; callers can change `maxStates`,
`maxCandidatesPerRecipe`, `maxPlacementMultiplier`, and `flowMaxStates` through
`PlacementPlanOptions`.

The score charges for placements, active material connections, additional producer branches and
consumer merges, belt trunks, boundary branches, and a small footprint tie-breaker. A small spill
still pays a fixed connection cost. Coordinates, distances, crossings, and physical corridor
feasibility are not yet part of this score.

Scores separate by material. A material network is cached by only the recipe choices involved in it,
using an integer mixed-radix key. Pure import/export branches separate further into independent
per-recipe factors: ten consumers of an imported resource do not require a ten-recipe cache entry.
Small factors involving at most two recipes are tabulated to obtain lower bounds. Unfinished wide
factors use zero as a conservative lower bound. Together with minimum remaining footprint costs and
placement counts, these bounds prune whole subtrees that cannot beat the incumbent. No beam pruning
or local hill climbing remains.

Geometry and ports are built once per shortlisted recipe candidate. The hot combination loop adds
cached scalar scores; it does not reconstruct cell geometry or retain every connection graph. The
selected material flows are reconstructed for the winner.

Diagnostics report candidate counts and their product, complete evaluations, pruned combinations,
material-network evaluations, placement limits, and stop reason. A completed search is exhaustive
within the selected candidate sets and the reported sparse-flow allocation policy. `optimal` remains
false because the candidate family, workload alternatives, and bounded material support search do
not cover all possible physical layouts.

## Browser performance

Run `node scripts/benchmark-placements-browser.ts` from the repository root with Google Chrome
installed. It uses Node's built-in WebSocket support, a temporary Chrome profile, and a temporary
Vite server; it needs permission to launch processes and bind localhost outside the sandbox. It
measures five warm planner runs per case after separately searching real Space Age kernels, then
opens and interacts with the actual app's processing-unit cell. Reports and a screenshot are saved
under the printed temporary profile directory. No browser automation dependency is installed.

On this development machine, headless Chrome 154 with the dataset's 60-item/s turbo belt measured:

| Case                                              | Candidate product | Median planner time |
| ------------------------------------------------- | ----------------: | ------------------: |
| Original processing-unit rates, validated kernels |             7,776 |               31 ms |
| Synthetic 250-building, ten-recipe chain          |        60,466,176 |               10 ms |
| Synthetic 250-building, ten-recipe shared import  |        60,466,176 |              1.1 ms |

The large products include safely pruned subtrees; these timings do not mean 60 million separate
flow graphs were constructed. All three searches completed their candidate spaces. Uncached kernel
search for the real five-recipe case took about 1.5 seconds separately from placement planning.
Browser CPU, selected kernels, network connectivity, and candidate limits affect these results; a
dense material network can still reach the search budget.

## Sparse material flow allocation

`flow-search.ts` minimizes active producer-consumer connections for each material. A max-flow oracle
first establishes the maximum achievable internal rate, including gross return flows and forbidden
self-supply. Support search then forbids incumbent edges and checks whether the same rate remains
feasible. Every strictly smaller support omits an incumbent edge, so exhaustive support search can
prove a minimum within this material model. The oracle gives preference to exact supply-demand
matches for a useful first incumbent.

The default standalone limit is 64 support states per material; the joint planner uses 24 and caches
network scores between cell candidates. A budget stop retains a feasible maximum-flow assignment and
does not turn internally matchable material into station overflow. Unmatched rates remain explicit
and can connect only to declared cell import/export stations. The chosen material assignments are
retained with the chosen stack split.

## Regression coverage

`test/compute/placement-plan.test.ts` covers the processing-unit example, exact building and
workload conservation, full flow conservation, station and port assignment, dedicated remainders,
several repeated dedicated feeds, placement limits, immediate budget stops, pair repeats, estimated
odd remainders, cycles, gross returns, unresolved cells, and deterministic recipe ordering. It also
checks the nine-building power sequence, compares pruning against an independent full-product
evaluation, and verifies cache reuse for large chains and shared imports.

For the processing-unit fixture, the default plan uses nine placements and 75 buildings while
reducing internal handoffs from the balanced plan's 13 to 11. The test checks routing behavior
rather than prescribing a single recipe partition: exact upstream and downstream matches can compete
for the same boundary.

`test/compute/placement-flow-search.test.ts` compares the sparse allocator with an independently
enumerated integer transportation oracle, and covers conservative budget stops, exact handoffs,
ordering, and gross cyclic flows.
