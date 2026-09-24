# Plan: assembler access and periodic column allocation

Status: proposed architecture; no solver behavior changes in this document.

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

Use deterministic backtracking with propagation and branch-and-bound for discrete geometry, plus a
small linear feasibility problem for rate allocation after discrete choices are fixed. Keep these
behind separate interfaces. This gives us a practical first implementation and leaves room for a
constraint-programming backend if measurements later justify it.

Target one machine first, using an internal model that already supports several machines. Extend to
small groups, typically one to five, without introducing a second layout algorithm. The supported
machine count is a search budget decision, not a geometrical rule.

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

The solver receives fixed machine operating rates. It places machines and transport; it does not
choose recipes, solve machine ratios, or silently reduce throughput to make a layout fit.

Normalize [KernelProblem](../src/compute/kernel-problems.ts) into explicit machine instances and
resource demands. Give each instance an ID independent of its recipe name. Retain gross inputs and
outputs even when the same resource occurs on both sides: net boundary rates do not describe the
transfers required by a catalyst or an internal production chain.

For multiple machines, require enough information to reconcile every resource:

`external supply + machine production = machine consumption + external export`.

An internal resource may use direct insertion or local transport. Do not infer that it disappears
because the boundary omits it. Reject inconsistent specifications before searching.

Add the following solver inputs and outputs, initially through an adapter around the existing API:

| Object             | Required information                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Machine instance   | Stable ID, footprint, allowed rotations, input/output rates, actual fluid-box assignments                                                 |
| Transport rules    | Belt lane capacity, underground reach and pairing rules, pipe connectivity, available inserter configurations and transfer capacities     |
| Search envelope    | Maximum width and pitch, allowed placement/routing primitives, deterministic search budget                                                |
| Repeat requirement | Requested copy count, defaulting to one; optional physical module height                                                                  |
| Solved kernel      | Entities, explicit width and pitch, machine placements, lane and fluid assignments, transfer rates, boundary interface, validation result |
| Search result      | Valid candidate and search status, or invalid input / exhausted envelope / budget exhausted / unsupported rule                            |

Carry recipe products' fluid-box indexes as well as ingredients'. The current
`AssemblerSpecification.fluidIngredients` is insufficient for a general output-port assignment.
Reuse [fluidBoxResources](../src/compute/fluid-box-resources.ts), with explicit diagnostics when
necessary mapping information is missing or incompatible.

The repository's [domain model](guides/FACTORIO.md) treats fluid throughput as unlimited. Preserve
that as an explicit transport policy while enforcing connectivity and fluid separation. If a later
policy adds flow limits or temperature compatibility, route feasibility must use it; the current
policy does not constitute a fluid simulation.

## Represent the repeating space directly

A candidate occupies `[0, W) × [0, H)` and repeats by `(0, H)`. `H` is a decision variable, starting
at a lower bound from the machines and growing when access or routing needs more rows. Blank routing
space is part of the candidate, even if it contains no entity.

Every advertised external trunk connects the bottom boundary to the top boundary. Input and output
belts may travel in opposite directions; geometric continuity does not require northbound outputs.
Pipes expose compatible connections at both boundaries. Local internal routes need not be trunks.

A boundary interface records each track's x-coordinate, transport kind, direction, lane resources,
fluid identity, and any underground endpoint phase. Ordinary surface continuations are the first
implementation. Later, seam-crossing underground pairs support the phased trunks in the
[chemical-plant fixture](blueprints/ASSEMBLERS.md#the-rectangular-chem-2f2s-in-1f1s-out-pattern).

Represent a connection across a seam as an edge with a copy offset. This distinguishes a pipe in the
current tile from its potential partner one tile above. Store each entity once using spatial
ownership; do not duplicate an endpoint because two machine branches use it. Initially keep machine
footprints wholly inside the rectangle to simplify ownership.

Expose the repeat interface to the module builder. For a finite run it also needs end connections or
caps that complete seam-spanning transport. Periodic connectivity alone does not prove that a finite
export has working first and last copies.

## 1. Derive access options from each machine

For each machine placement and allowed rotation, derive geometry before making transport choices.
Use occupied cells and transformed ports, with the existing integer-grid convention. This also
handles rectangular and even-sized machines without assuming a central row exists.

For solid transfers, enumerate legal inserter configurations by working outward from potential
pickup/drop points in the machine footprint. Each option records:

- Inserter base, footprint, configuration, pickup and drop endpoints.
- Source and destination machine IDs or transport attachment points.
- Reachable belt columns, surface rows, pickup lanes and actual drop lane.
- Permitted resources and filter requirements.
- Capacity under the supplied rule, and all occupied cells and connection requirements.

Enumerate all four machine sides. East/west access is usually cheaper because it faces the vertical
trunks. North/south access is legal when extra rows and branch routing can connect it. Prefer
cheaper options in search order, but make any initial routing restriction explicit in the envelope.

An ordinary and a long inserter at the same base are alternative uses of one cell. Adding a far belt
does not create another base. An underground belt's hidden segment is not a pickup surface. Inserter
arms may reach across occupied cells when the rules permit; reserve their actual footprint rather
than their entire swept rectangle.

For fluids, derive required logical connections from assigned boxes, then enumerate the physical
ports that can satisfy each connection. Multiple ports on one box can be alternatives; distinct
required boxes remain distinct obligations unless the fluid model explicitly groups them. A selected
port reserves its outside connection cell and a route to its fluid network. Keep unselected port
faces in the connectivity model, since a passing pipe must not connect to an incompatible box.

Do not permanently reserve every possible fluid route before selecting inserters. Reserve mandatory
cells immediately; retain alternative port and route choices as domains. Prefer the connection with
the fewest legal choices, whether it is fluid or solid.

### Inserter rules are data and behavior, not layout cases

Define an inserter rule provider with operations to enumerate configurations, determine endpoints
and lane access, determine filter support, and compute a capacity constraint for a transfer context.
Start with today's ordinary and long inserters and caller-supplied rates. Later rules can introduce
asymmetric reach, configurable pickup/drop positions, item stack effects or different belt/machine
transfer rates through this provider.

The search selects as many compatible configurations as the rate constraints require. For identical
inserters, `ceil(requiredRate / capacity)` is a useful lower bound. The upper bound comes from
actual nonconflicting sites. There is no `maxInserters = 2`, nor a replacement limit such as “three
belts fit any assembler”. Two lanes per belt remains a transport fact supplied by the belt model.

## 2. Allocate columns and lanes against those options

Use **track** for a vertical belt or pipe and retain `DesignColumn` for the whole repeating kernel.
A track is a decision object, not initially a list of entities. It has an x-coordinate, transport
kind, direction, assigned resources and an allowed row profile.

The row profile records surface transport, underground endpoints/spans, branch attachments, and rows
that must stay accessible to selected inserters. Two tracks can be adjacent only if their actual
connectivity is compatible: two independent ordinary pipe trunks would join without separation or
appropriate underground geometry. Track width alone does not describe this constraint.

Allocate tracks in the corridors outside and, for several machines, between machine footprints.
Candidate x-coordinates come from the bounded rectangle. Inserter endpoints immediately restrict
which of those columns can directly serve a machine. More distant columns need a realizable branch;
they are not extra capacity just because there is empty space for them.

For each belt lane, assign one resource under the dependable one-item-per-lane policy. An item may
occupy several lanes or belts, but the solution must state their separate rates and the boundary
supply contract. If this requires an upstream split, expose that requirement to the module router;
do not count one supplied lane twice. The kernel need not build station routing itself.

Explore lane packing and track order together with access choices. Sorting resources by constraint
and rate gives a useful search order, but insertion order in a JavaScript object must not determine
which items can share a belt. Output lanes are constrained by the actual inserter drop geometry.
Adding several inserters on one side of a belt does not make both lanes available.

Use lower bounds to prune: the required number of lanes, the transfer capacity reachable from each
demand, and the combined capacity of sites shared by several demands. Passing independent checks for
each item is insufficient when all of them rely on the same inserter base.

## 3. Solve space and transfer capacity together

Maintain a shared constraint state covering machine placements, selected access options, tracks,
lane assignments, fluid routes and underground pairs. Each choice reduces other domains. Conflicts
include occupied cells, incompatible pipe adjacency, invalid underground pairing and a lost transfer
endpoint, as well as insufficient throughput.

With geometry and resource assignments fixed, allocate nonnegative rates to legal transfers.
Require:

- Every machine input and output has its specified total transfer rate.
- Each lane and each routed belt segment stays within capacity.
- Each selected inserter stays within its capacity, shared across all resources it moves.
- Internal transfers conserve each resource; boundary flows match the declared interface.

For the initial constant-rate inserter model, `sum(resource rates through inserter) <= capacity` is
enough. A later resource-dependent model can use a time budget, for example
`sum(rate[r] / capacity[r]) <= 1`, where the rule provider guarantees that model is valid. More
complex rules may require discrete operating modes or conservative capacity bounds.

This residual allocation is a small linear feasibility problem. Use a dedicated LP adapter; the
existing cell solver's RREF handles equalities and is not an inequality solver. Select a
browser-safe implementation during the first capacity milestone, measuring bundle size and runtime
on the fixture corpus. A flow algorithm can replace the LP for a restricted case only when it
preserves resource identity and shared inserter budgets. Do not independently solve each resource
and reuse the same inserter's full capacity in every solution.

Rate feasibility is conditional on the declared supply and inserter model. Mixed-input pickup needs
a capacity rule that accounts for sharing; filtered outputs require a configuration that can enforce
the lane assignment. Never turn an arithmetic allocation into an implicit scheduling guarantee.

### Example: a taller machine with a blocked side row

Suppose a five-row machine has a fluid connection occupying the middle east-side base cell. Four
ordinary output-inserter bases remain on that side. At 3 items/s each, an 11 items/s output needs
all four. It is feasible there if their drop lane can carry 11 items/s and the selected pipe route
leaves their belt endpoints accessible. At 13 items/s that side is insufficient.

The search then tries another compatible access site, machine rotation, output track or branch
arrangement. Widening the rectangle alone does not help if no additional transfer can reach the
machine. Increasing pitch may enable north/south access, but does not create extra east-side rows on
the machine. A three-row version with the same blocked middle row really has only two remaining
east-side bases; that count is derived from geometry.

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

For the first version, support direct access to straight vertical belts and general local pipe
branches. Add item branches and lane-changing constructions through the same primitive interface.
Until then, report that restriction as part of the searched envelope rather than claiming general
infeasibility.

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

For a requested repeat count, minimize `W * H`, then underground pairs, total transport entities,
and a canonical geometry key. Use the declared rectangle area, including reserved empty space.
Return repeat capacity as well: a compact kernel with poor stack capacity may be worse for the
module builder. A future caller can request a frontier over width, pitch and supported copies
without changing feasibility rules. Do not silently trade away a requested copy count to improve
area.

Budget exhaustion may return a valid incumbent with `optimal: false`. Exhausting one bounded
envelope means “no solution using these bounds and primitives”, not “this recipe cannot be laid
out”. Pruning must use sound bounds to claim even that limited result. Give failures concrete
witnesses, such as a set of demands competing for insufficient sites, and label witnesses that are
local to a placement.

## 6. Validate periodic geometry and loaded transport

Create a pure validator shared by generation, previews and fixture tests. It must reconstruct actual
connectivity from emitted entities and compare it with the proposed assignments, rather than
trusting the search's selected pair IDs or resource labels.

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

Reuse the belt model in [src/bp](../src/bp/belt.ts) and extract suitable pure logic from
[design traces](../src/components/design/design-belt-traces.ts). Review their assumptions before
using them as validators: the fluid tracer currently accepts supply through any connected input box,
and the blueprint inserter tracer uses approximate endpoint entity matching. Generation needs exact
footprint and assigned-box checks. The new compute code should not depend on Preact components.

## Suggested module boundaries

Put the new solver under `src/compute/tile-design/`; `src/solve/` currently solves cell rates. Keep
`src/compute/assembler-design/` only for migration and cross-validation, then leave it unused.

| Module                  | Responsibility                                                             |
| ----------------------- | -------------------------------------------------------------------------- |
| `problem.ts`            | Normalized instances, gross demands, fluid assignments, boundary contract  |
| `transport-rules.ts`    | Inserter configurations/capacity and belt/pipe capability interfaces       |
| `access.ts`             | Rotated geometry, transfer and fluid-port options, conflicts               |
| `tracks.ts`             | Track domains, row profiles, lanes and boundary signatures                 |
| `routes.ts`             | Local path alternatives and transport primitive expansion                  |
| `capacity.ts`           | Residual rate constraints, feasibility adapter and repeat load calculation |
| `search.ts`             | Placement, propagation, branching, bounds, scoring and diagnostics         |
| `emit.ts`               | Solver result to editable design entities and interface metadata           |
| `../design-validation/` | Pure geometry, connectivity and capacity validation, shared with previews  |

Persist explicit pitch and interface metadata when a generated kernel becomes an editable design.
Edits must invalidate/recompute its certificate. Update stacking and export consumers to use pitch;
do not insert dummy entities to make occupied bounds simulate an empty routing row. Introduce
optional metadata with an adapter for existing designs, and handle any persisted format/hash changes
through the repository's normal versioning checks.

## Delivery plan and acceptance criteria

1. **Define the normalized contract and validator.** Adapt existing generated designs and blueprint
   fixtures; expose their assumptions and any validation failures. Preserve existing strategy tests,
   but distinguish tests of physical feasibility from tests of an old strategy's deliberate limits.
   A previously expected rejection is not evidence that a new valid solution is wrong.
2. **Implement one-machine solid allocation.** Add access enumeration, track/lane choices, capacity
   allocation and bounded search. Require rate-driven use of three or more inserters, variable
   rectangular footprints, multiple filtered products and reordered resource maps. Compare small
   bounded cases with an exhaustive enumerator to check pruning and feasibility.
3. **Add fluid branches and periodic seams.** Express the existing opposing-port, outside-trunk and
   casting adaptor cases using the same access/track/route machinery. Include the full mixed
   chemical-plant reference, moved ports, additional fluid networks, alternate port choices,
   pipe-isolation failures and seam partner conflicts. No recipe-specific branch in the search.
4. **Integrate generated metadata and switch the entry point.** Carry pitch, boundary supply
   requirements and stack capacity into previews, module placement and export. Cross-validate
   against legacy seeds through the same gate. Once supported fixtures and perturbations pass,
   switch consumers to `tile-design` and leave `assembler-design` unused. Measure search cost and
   layout quality before choosing the default budget.
5. **Extend placement to small machine groups.** Add direct insertion as machine-to-machine access
   options and internal belt/pipe routing. Exercise the two-machine snake, a 3:2 group, and internal
   resource balance. Keep fixed machine counts and rates; enlarge search budgets explicitly.

Across these milestones, add generated cases varying footprint dimensions, port positions, resource
order, rates, belt capacity and inserter rules. Check validity rather than exact coordinates except
where canonical output is the behavior being tested. Include cases constructively known to have a
solution, not only a validator that could pass by rejecting every unfamiliar shape.

Acceptance means: all returned candidates pass independent periodic and rate checks; the supported
corpus retains coverage; altered shapes succeed without new shape predicates; exhausting a budget is
reported honestly; and required inserter counts follow demand and available access space. Track
width, pitch, supported copies and search effort alongside success rate, so generalization does not
conceal unusable layouts or UI stalls.
