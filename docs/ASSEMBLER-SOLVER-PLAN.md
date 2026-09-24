# Plan: assembler access and periodic column allocation

Status: migration history and remaining delivery plan. The implemented one-machine search is
described in [TILE-SEARCH.md](guides/TILE-SEARCH.md); source code defines its current limits.

## Recommendation

Replace the recipe-shape strategy registry with a **bounded constraint search over machine access,
vertical transport columns, and local connections**. Make the repeating rectangle and its boundary
connections explicit. Generate possible transfers from machine geometry and transport rules, then
select a compatible set whose capacity meets every machine's rates.

The central object should be a machine's **access map**: all legal ways of transferring an item or
connecting a fluid, including the space each option occupies and the columns it can reach. Column
allocation and access selection must constrain each other. Neither can be completed greedily before
the other: a nearby belt is useless without enough inserter sites, and a free inserter site is
useless without a reachable, correctly populated belt lane.

Keep discrete geometry search separate from rate feasibility. The implemented one-machine family
uses bounded deterministic search and a fractional-flow capacity adapter. Internal transport and
more general inserter rules may need a broader feasibility model.

The normalized contract supports several machine instances; the current search supports one. Extend
it first to an exactly two-machine repeat unit, then to small groups without introducing a second
layout algorithm.

## Why the current structure resists extension

[ASSEMBLER-DESIGN.md](ASSEMBLER-DESIGN.md) describes the current coverage. The implementation
already has useful general pieces: rotated footprints, fluid-box assignments, inserter throughput
inputs, and belt tracing. The problem is where those pieces are combined:

- [Solid strategies](../src/compute/assembler-design/solid-strategies.ts) choose particular belt
  positions and then allocate sites. `wideInputSiteGroups` gives the far-west belt one site;
  `solveWideSolidDesign` slices output positions to two. These are properties of a construction, but
  become feasibility limits for a whole class of problems.
- Fluid strategies encode port arrangements and repair an existing solid layout. A south-facing port
  needing another row becomes a dedicated adaptor strategy instead of an ordinary space claim.
- [The entry point](../src/compute/assembler-design.ts) compares occupied area and trusts each
  strategy's result. Its first reported rejection describes one construction, not the search space.
- [DesignColumn](../src/compute/design.ts) stores entities alone. Repeat pitch, lane assignments,
  seam connections, and the reason a transfer has sufficient capacity are inferred elsewhere.

Use the current strategies as candidate seeds and cross-validation references while building the new
solver. Their successful geometry is useful evidence; their input/output counts should not define
the new solver's domains. Once integration and cross-validation are complete, the new solver should
run without using the old `assembler-design` module.

## Scope and contract

The [normalized input](../src/compute/tile-design/types.ts) contains machine instances, fixed
resource rates, physical fluid access and transport rules. Recipe selection and machine-ratio
solving are upstream of this contract; a recipe cannot enter the tile search through its input
types. Each instance has an ID independent of its recipe name. Gross inputs and outputs remain
separate even when the same resource occurs on both sides.

For multiple machines, require enough information to reconcile every resource:

`external supply + machine production = machine consumption + external export`.

An internal resource may use direct insertion or local transport. Do not infer that it disappears
because the boundary omits it. Reject inconsistent specifications before searching.

The [adapter](../src/compute/tile-design/problem.ts) accepts both ingredient and product fluid-box
indexes and checks the boundary balance. The search currently supports one machine with external
flows; multiple machines and internal transfers remain to be implemented.

The repository's [domain model](guides/FACTORIO.md) treats fluid throughput as unlimited. Preserve
that as an explicit transport policy while enforcing connectivity and fluid separation. If a later
policy adds flow limits or temperature compatibility, route feasibility must use it; the current
policy does not constitute a fluid simulation.

## Represent the repeating space directly

A candidate occupies `[0, W) × [0, H)`. The current one-machine family repeats by `(0, H)` and fixes
`H` to machine height. The two-machine checkpoint must represent either a vertical `(0, H)` or a
horizontal `(W, 0)` repeat, with the repeated dimension chosen from placement and routing needs.
Blank routing space counts even if it contains no entity.

For a vertical repeat, every advertised external trunk connects the bottom boundary to the top; for
a horizontal repeat, it connects the left and right boundaries. Input and output belts may travel in
opposite directions. Pipes expose compatible connections at both repeat boundaries. Local internal
routes need not be trunks.

A boundary interface records each track's position along the seam, transport kind, direction, lane
resources, fluid identity, and any underground endpoint phase. The current vertical family uses
ordinary surface continuations. Later, seam-crossing underground pairs support the phased trunks in
the
[chemical-plant fixture](blueprints/ASSEMBLERS.md#the-rectangular-chem-2f2s-in-1f1s-out-pattern).

Represent a connection across a seam as an edge with a copy offset. This distinguishes a pipe in the
current tile from its potential partner in the next copy. Store each entity once using spatial
ownership; do not duplicate an endpoint because two machine branches use it. Initially keep machine
footprints wholly inside the rectangle to simplify ownership.

Expose the repeat interface to the module builder. For a finite run it also needs end connections or
caps that complete seam-spanning transport. Periodic connectivity alone does not prove that a finite
export has working first and last copies.

## 1–2. Access options, tracks and lanes

[TILE-SEARCH.md](guides/TILE-SEARCH.md) records the implemented one-machine access, track, lane and
fluid-port search. It covers rotated and mirrored footprints, ordinary and long inserter bases,
shared base occupancy, actual belt pickup/drop lanes, alternative fluid ports, isolated pipe
networks and capacity-driven lane splits. The current tracks are straight vertical trunks;
north/south item access, bends and local item branches still need routing primitives. Those
primitives must expose their occupied cells and actual track attachments so a distant column cannot
be counted as access merely because space exists for it.

### Inserter rules are data and behavior, not layout cases

The current rule data describes filter-capable, constant-capacity inserters with one- or two-tile
reach. Modded inserters need a rule provider for configurable or asymmetric endpoints, lane access,
filter support and transfer-dependent capacity. Site and lane bounds must continue to use actual
reachable configurations, with one shared budget per occupied base.

## 3. Extend shared rate allocation

The one-machine search already branches over conflicting sites, lanes, fluid routes and underground
choices. Its fractional-flow adapter allocates constant-rate item transfers while sharing each
inserter base's capacity; an independent validator checks emitted geometry and rates. See
[TILE-SEARCH.md](guides/TILE-SEARCH.md) for the implemented model and the blocked-side-row case.

For multiple machines, include internal transfers and each routed segment's cumulative load. Require
each machine's gross input and output rate, resource conservation through internal routes, and the
declared boundary flows. Resource-dependent modded inserter capacities may need a time budget such
as `sum(rate[r] / capacity[r]) <= 1`, discrete operating modes, or a dedicated linear feasibility
adapter. The current fractional-flow model does not establish pickup scheduling for mixed inputs.

## 4. Route branches with reusable transport primitives

Trunks provide the global structure. Route the short connections between them and machine access
points on a bounded grid using transport-aware primitives: surface segment, turn, compatible join,
underground pair, and inserter transfer. Expand those primitives into entities only when needed for
collision and connectivity checks or final output.

The familiar fluid adaptor becomes a route from a south port, through a spare row, to a trunk. An
outside fluid trunk becomes a pipe branch crossing belt columns through legal underground pairs.
Neither requires a recipe-count predicate or a named assembler shape.

Try constrained connections first and cheap routes first. Keep alternate routes and backtrack into
column order, site selection or pitch when routing fails. A single shortest-path result per branch
would reproduce the current brittleness. Cache failed combinations of the relevant choices; failure
of one route must not forbid all routes between those endpoints.

Underground pairs are atomic choices with separate surface occupancy and underground connectivity.
Validate prototype reach, endpoint orientation and actual nearest-compatible pairing, including
neighboring copies. Crossing underground spans is allowed only under the selected transport rules.
Pipe adjacency is a connection, not just a collision test, and must participate in routing.

The current family has direct access to straight vertical belts and limited horizontal fluid
branches. Add item branches, bends, lane-changing constructions, north/south fluid branches and seam
phases through route alternatives. Until each is implemented, report the actual searched envelope
rather than claiming general infeasibility.

## 5. Search, scoring and stopping

Use the following outer loop, with propagation and backtracking inside each envelope:

1. Normalize rates, fluid assignments and transport rules; reject invalid inputs.
2. Enumerate bounded rectangle sizes and machine rotations/placements in lower-bound cost order.
3. Derive access options and potential tracks; propagate mandatory cells and capacity bounds.
4. Branch on the smallest remaining domain across ports, sites, lanes, tracks and routes.
5. Check residual rate feasibility, then independently validate complete candidates.
6. Retain the best validated candidate and continue until the budget or proven bound stops search.

For one machine, fix translation and enumerate rotations and routing margins. For multiple machines,
start with aligned rows and columns as placement seeds, then explore bounded integer placements with
non-overlap constraints. Symmetry reduction can remove permutations of identical instances. Only
merge rotations or reflections when port, lane and inserter rules actually preserve the geometry.

Cache access geometry by machine/rule/rotation and canonicalize resource and machine ordering. Use
deterministic expansion budgets for repeatable tests, with cancellation or a time limit for the UI.
Record explored states, rejected constraints, best score and remaining search scope for diagnosis.

The current one-machine score orders rectangle area and transport entity count. Leave scoring
improvements for a later milestone; pair support is accepted on validity, capacity and honest search
scope. Continue to enforce the requested repeat count and report supported copies rather than
trading capacity away for a smaller area.

Budget exhaustion may return a valid incumbent with `optimal: false`. Exhausting one bounded
envelope means “no solution using these bounds and primitives”, not “this recipe cannot be laid
out”. Pruning must use sound bounds to claim even that limited result. Give failures concrete
witnesses, such as a set of demands competing for insufficient sites, and label witnesses that are
local to a placement.

## 6. Validate periodic geometry and loaded transport

The [independent validator](../src/compute/design-validation/validate.ts) reconstructs connectivity
from emitted entities and compares it with proposed assignments. Extend it for multiple machines,
branched belts, seam-spanning pairs and finite end connections without trusting selected pair IDs or
resource labels.

Validate footprints, exact transfer endpoints, filters, lane continuity, required fluid boxes,
network separation and underground pairing. For periodic geometry, inspect a neighborhood large
enough to include every possible interacting copy: derive it from maximum underground reach and
entity/transfer extent relative to `H`. Three copies are useful fixtures, but are not sufficient for
all future reaches and small pitches. Alternatively, validate the periodic graph analytically with
copy-offset edges.

Distinguish geometrical repetition from capacity under repetition. For `N` identical tiles with
external-only trunks, a lane carrying `r` per tile needs `N * r <= laneCapacity`. For shared
internal transport, calculate each segment's cumulative load from the actual sources and sinks: net
boundary flow alone can hide the peak. Inserter demand remains per machine, not multiplied on each
inserter. For a finite module, require a boundary supply/export contract that makes every segment
load nonnegative in its travel direction and within capacity.

Report the largest supported copy count under that contract, bounded by physical height if supplied.
Cycles requiring startup inventory should retain that requirement in the result; a balanced steady
state does not prove self-starting operation.

## Module boundaries and integration

The search and emission modules live under `src/compute/tile-design/`; the independent validator is
under `src/compute/design-validation/`. Keep `src/compute/assembler-design/` for migration and
cross-validation until consumers switch to the new search.

Persist explicit pitch and interface metadata when a generated kernel becomes an editable design.
Edits must invalidate/recompute its certificate. Update stacking and export consumers to use pitch;
do not insert dummy entities to make occupied bounds simulate an empty routing row. Introduce
optional metadata with an adapter for existing designs, and handle any persisted format/hash changes
through the repository's normal versioning checks.

## Delivery plan and acceptance criteria

1. **Completed: normalize and validate.** The adapter supplies fixed machine rates, gross demands,
   fluid-box assignments and a balanced boundary contract. Independent validation checks emitted
   one-machine geometry, connectivity and capacity. See [TILE-SEARCH.md](guides/TILE-SEARCH.md).
2. **Completed: one-machine item search.** Access, straight tracks, lane assignment and shared
   inserter capacity are searched within a bounded envelope. The documented verification includes
   rectangular machines, multiple products, resource ordering and an exhaustive allocator check.
3. **In progress: complete the fluid route family.** The search handles alternative ports, isolated
   networks, horizontal pipe branches and in-tile belt tunnels. Add south/north port adaptors,
   uneven pitch, phased seam-spanning pipes and belts, and the full mixed chemical-plant reference.
   Keep failures scoped to supported primitives and avoid recipe-specific branches.
4. **Integrate generated metadata and switch the entry point.** Carry pitch, boundary supply
   requirements and stack capacity into previews, module placement and export. Cross-validate
   against legacy seeds through the same gate. Once supported fixtures and perturbations pass,
   switch consumers to `tile-design` and leave `assembler-design` unused. Measure search cost and
   layout quality before choosing the default budget.
5. **Support exactly two assemblers per tiling unit.** Search two placements and their independent
   orientations inside one explicit repeat rectangle, with fixed rates and external item/fluid
   flows. Choose the vertical repeat used by the snake or the horizontal repeat used by
   `chem-flippos`; expose the matching pair of boundary faces in the interface. Allow touching
   machines and alternating mirrors, while preserving each machine's fluid-box assignment. Route
   shared trunks and local connections against both access maps; support the seam-spanning
   underground phases and the opposite output lanes required by the
   [two-assembler snake](blueprints/ASSEMBLERS.md#the-fixed-2s-in-1s-out-snake-kernel), and isolated
   alternating fluid networks as in
   [chem-flippos](blueprints/ASSEMBLERS.md#alternating-mirrored-plants-chem-flippos). Treat the two
   machines as one repeat unit: aggregate boundary rates and lane loads, then validate at least
   three translated units and the first/last connections of a finite run. Accept generated
   variations as well as the fixtures, with no shape- or recipe-specific search branch. Report
   unsupported internal handoffs explicitly at this checkpoint.
6. **Extend to small machine groups and internal flows.** Add machine-to-machine insertion and
   internal belt/pipe routing, then exercise a 3:2 group and resource balance. Keep fixed machine
   counts and rates; enlarge search budgets explicitly.

Across these milestones, add generated cases varying footprint dimensions, port positions, resource
order, rates, belt capacity and supported inserter rules. Check validity rather than exact
coordinates except where canonical output is the behavior being tested. Include cases constructively
known to have a solution, not only a validator that could pass by rejecting every unfamiliar shape.

Acceptance means: all returned candidates pass independent periodic and rate checks; the supported
corpus retains coverage; altered shapes succeed without new shape predicates; exhausting a budget is
reported honestly; and required inserter counts follow demand and available access space. Track
width, pitch, supported copies and search effort alongside success rate, so generalization does not
conceal unusable layouts or UI stalls.
