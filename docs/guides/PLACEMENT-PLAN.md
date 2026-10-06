# Splitting and connecting physical placements

`src/compute/placement-plan/search.ts` plans a whole solved cell before 2D placement. It replaces
independent equal stack splitting followed by arbitrary overflow allocation. `CellBox` passes the
plan's modules and its retained flow assignments to station connection and port assignment; it must
not allocate the internal flows again after selecting the split.

This is the physical stack counterpart of the logical decomposition described in
[`../SPLIT.md`](../SPLIT.md). It does not create independently solved child cells or change the
recipe solution.

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

## Joint bounded search

The initial plan uses the fewest supported stacks for each recipe. Candidate workload boundaries
come from:

- individual consumer demands divided by the producer's per-machine output;
- individual producer supplies divided by the consumer's per-machine input;
- pairs of those amounts, their complements, and symmetric seeds; and
- integer workload boundaries, sampled for very large recipes.

A move can replace a recipe's split, preserve a dedicated workload while introducing a second, or
split its largest block while preserving its smaller dedicated feeds. Every move is evaluated
against the entire cell with new conserved flow assignments. Spare buildings stay within their
recipe; they cannot be borrowed across recipes.

The default limits are twice the minimum number of placements, 800 evaluated cell candidates, and a
beam width of eight. Callers can override these through `PlacementPlanOptions`. The placement
multiplier is not a building multiplier. The score charges for placements, every active material
connection, additional producer branches and consumer merges, required belt trunks, boundary
branches, and a small footprint tie-breaker. A small spill still pays the fixed connection cost.
Coordinates, route lengths, crossings, and physical corridor feasibility are not yet part of this
score.

The search is deterministic and keeps a valid incumbent at a budget stop. Its diagnostics expose the
minimum and maximum placement counts, evaluated states, and stop reason. `optimal` is always false:
candidate generation and beam pruning do not prove a global optimum, even when the generated
neighborhood is exhausted.

## Sparse material flow allocation

`flow-search.ts` minimizes active producer-consumer connections for each material. A max-flow oracle
first establishes the maximum achievable internal rate, including gross return flows and forbidden
self-supply. Support search then forbids incumbent edges and checks whether the same rate remains
feasible. Every strictly smaller support omits an incumbent edge, so exhaustive support search can
prove a minimum within this material model. The oracle gives preference to exact supply-demand
matches for a useful first incumbent.

The default standalone limit is 64 support states per material; the joint planner uses 24 and caches
equivalent material networks between cell candidates. A budget stop retains a feasible maximum-flow
assignment and does not turn internally matchable material into station overflow. Unmatched rates
remain explicit and can connect only to declared cell import/export stations. The chosen material
assignments are retained with the chosen stack split.

## Regression coverage

`test/compute/placement-plan.test.ts` covers the processing-unit example, exact building and
workload conservation, full flow conservation, station and port assignment, dedicated remainders,
several repeated dedicated feeds, placement limits, immediate budget stops, pair repeats, estimated
odd remainders, cycles, gross returns, unresolved cells, and deterministic recipe ordering.

For the processing-unit fixture, the default plan uses nine placements and 75 buildings while
reducing internal handoffs from the balanced plan's 13 to 11. The test checks routing behavior
rather than prescribing a single recipe partition: exact upstream and downstream matches can compete
for the same boundary.

`test/compute/placement-flow-search.test.ts` compares the sparse allocator with an independently
enumerated integer transportation oracle, and covers conservative budget stops, exact handoffs,
ordering, and gross cyclic flows.
