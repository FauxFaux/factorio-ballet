# Item and fluid tile search

`solveTileDesign` in `src/compute/tile-design/search.ts` implements one-machine item and fluid
allocation following the architecture of `docs/ASSEMBLER-SOLVER-PLAN.md`. It consumes normalized
fixed rates; `normalizeTileDesignInput` remains the adapter from `KernelProblem`. The kernel debug
cards compare this search with the legacy assembler generator. Other design consumers still use the
legacy path.

The search supports any number of item ingredients and products that fit the available geometry and
capacities. It preserves gross input and output demands, including catalysts. Each gross transfer
must have a corresponding external supply or export. Internal recirculation and multiple machines
return `unsupported`. Fluids use unlimited-throughput networks with explicit physical box
obligations; each resource must have an external supply or export on the corresponding side. When
several physical boxes are assigned the same fluid on one side, connecting any one of them satisfies
that resource's obligation. Other boxes may remain unconnected, leaving their neighboring cells
available for item inserters.

## Geometry and transport model

- Enumerate allowed rectangular footprint orientations and subsets of reachable straight vertical
  tracks with surface segments and optional underground spans. Northbound is canonical: reversing a
  straight belt just swaps its free lane variables in this model.
- Enumerate ordinary and long inserter bases on all four faces. Long inserters can stand either one
  or two cells from the edge, provided their machine endpoint lies inside the footprint. Ordinary
  and long configurations at the same base are alternatives.
- Straight item trunks can serve east/west faces only. North/south item access needs later item
  branches. Most tiles repeat at the rotated machine height; the south fluid adaptor adds one row.
  The search does not stagger machines.
- One resource and one external flow role per lane. Inputs can pick either lane; outputs use the
  actual far lane. Several inserters on one face do not unlock the other output lane.
- All supplied inserter rules currently describe filter-capable configurations with constant total
  throughput, shared across input resources. Identical reaches use the highest supplied capacity.
  Multiple products receive explicit output filters. Resource-dependent capacities or pickup
  scheduling require a richer rule model.

The track model exposes row profiles separately from access options, capacity allocation, and entity
emission. Future bends and item branches must supply their actual row attachments and occupancy
conflicts; an extra column alone does not promise extra access. The belt-bending example in
`docs/blueprints/ASSEMBLERS.md` is outside the current searched scope.

## Fluid routes and orientation

All allowed cardinal rotations and local-x mirrors are searched for fluid machines. Reflection is
applied before rotation, including port normals; resource and physical box identities stay attached
to the transformed ports. Rectangular and even footprints use centre-relative prototype positions,
including half-cell coordinates. Emitted assemblers retain `direction` and `mirrored`.

`routes.ts` chooses one assigned box and alternative port for each required fluid and side. For
east/west ports it enumerates two connection schemes:

1. A surface pipe trunk immediately beside the selected east/west port.
2. An inward-facing pipe-to-ground at the machine and an outward-facing partner beside a more
   distant surface trunk. The horizontal tunnel can cross belts and other pipe trunks underground.

The second scheme requires both `branch` and `underground` in the envelope. If either pipe endpoint
occupies a belt cell, enumerate in-tile underground belt pairs covering that obstruction. Endpoint
choices can preserve different inserter sites, or combine several obstructions in one tunnel. Hidden
rows cannot supply inserters; both exposed endpoints can. Inserter bases reserve only their actual
cells, so arms may cross pipes and other transport. Both underground reach settings count hidden
cells between endpoints; adapters from prototype fields must convert their distance convention.

For a south port at the rightmost machine column, it can add one adaptor row when `branch` and
`underground` are available. A pipe immediately below the port turns east into a vertical trunk
beside the machine. The trunk has a north-facing underground endpoint in row 0, a south-facing
endpoint at the machine's last row, and a surface pipe in the adaptor row. The tunnel passes under
the east-side inserter site; the endpoints pair within each tile, while the exposed top endpoint
meets the previous tile's adaptor pipe across the seam. Other full surface trunks extend through the
adaptor row. This gives the mono-silicon casting machine two isolated input networks in a four-row,
six-column tile with an east output belt. The adaptor is wrapper geometry: the machine's physical
port and recipe-fluid assignment stay unchanged.

Routes may share compatible geometry. Distinct fluid networks must remain isolated, including at
unselected ports and across the repeat seam. The validator reconstructs surface adjacency and mutual
nearest underground partners from entities, checks reach and exposed faces, and requires at least
one assigned box per fluid and side to connect to an advertised trunk. Pipes touching other assigned
boxes must still carry the correct fluid. Per-pipe resource assignments and per-trunk fluid
identities are emitted explicitly.

The one-machine family uses full surface pipe trunks and horizontal pipe pairs. Belt tunnels stay
wholly inside one tile, with exposed surface connections at the top and bottom, so finite modules
need no extra tunnel end caps. Periodic fluid adjacency is checked with wrapped seam edges;
horizontal pairing cannot reach a neighboring copy. Straight, non-overlapping in-tile belt pairs
likewise cannot steal another copy's partner. Validation also checks vertical underground pipe
phases, including pairs that cross the seam, and rejects unsupported belt routes.

For machines with at least two distinct fluid inputs or outputs, a separate two-machine repeat tries
opposite mirror states. Complementary vertical underground pipe spans can put the two fluid trunks
immediately beside the machine without mixing them. It can also place straight item belts and
inserters on free east or west faces; each such belt serves both machines in the repeat. An item
input can use both belt lanes when the combined rate exceeds one lane's capacity. This pair search
returns the first validated candidate within its reserved budget, while the one-machine search
remains the fallback.

Other north/south fluid branches, adapters for uneven stacking, and general alternating machine
orientations across copies remain outside this family. A larger routing model can add new route
primitives and boundary phases; the item rate allocation contract need not change. Kernel debug
cards display the selected geometry; integration with editable designs and module export remains
separate.

## HIGH design policy

`solveHighTileDesign` in `src/compute/tile-design/high/solve.ts` is an additional solver over the
same `TileDesignInput` and `TileDesignCandidate` contracts. It implements subsets of the two
patterns in [ASSEMBLERS-HIGH.md](../blueprints/ASSEMBLERS-HIGH.md), with horizontal underground
fluid branches replacing east/west inserter sites. It dedicates one belt to each gross item input
and one or more belts to each output, with at most `w + 4` belts for an oriented machine width `w`.
Each machine column adds an end belt; four side belts are available before fluid routing removes
access. A catalyst needs separate input and output belts.

The pattern supports allowed orientations of a `w×h` machine at least two tiles wide, within the
width and pitch envelope. A single has pitch `h + 4`; a touching pair has pitch `2h + 4`. Only used
belts and required inserters are emitted. The central `w` belts tunnel underneath the whole repeat
unit and have two ordinary input sites per machine in a single, or one in a pair. The four side
belts divide the available edge cells between ordinary near-belt and long far-belt inserters. Inputs
may occupy either one lane or both lanes of their single belt. When both lanes are used, the
certificate advertises equal rates and requires the module router to supply that split. Side outputs
use one far lane on a dedicated belt. End belts can also carry outputs: the north end targets the
right lane, and the south end targets the left lane of the northbound belt. A touching pair puts
each machine's production on its own lane; a single can use both end sites when rate requires two
lanes or inserters. Each lane's boundary rate reflects its actual producing sites. Multiple products
have matching output filters.

Each required fluid chooses an east/west port, including corner rows, with one fluid trunk per side.
The search tries a surface trunk immediately beside the machine, a horizontal pipe pair to a trunk
beyond one ordinary-reach belt, and a pair to a trunk beyond both side belts. An adjacent trunk
replaces all item access on its side, leaving the opposite edge available. A compact branch blocks
one edge site and tunnels its belt under the outer pipe endpoint; it needs no long inserter or empty
near-belt column. With two side belts, the near belt passes over the pipe tunnel and the far belt
tunnels under the outer pipe endpoint. Touching pairs of machines at most two tiles high use
adjacent fluid trunks because their side belt tunnels would share endpoint cells. Distinct fluids
have isolated trunks. North/south fluid branches, multiple fluid trunks on the same side, shared
belts for different items, and splitting an input across different belts remain outside this policy.
Outputs may span multiple dedicated belts when lane or inserter capacity requires it.

Code responsibilities are intentionally small:

| File               | Responsibility                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `high/geometry.ts` | Single/pair placements, side route alternatives, allowed orientations and fluid branches |
| `high/allocate.ts` | Memoized belt matching with two shared edge-site budgets and rate/reach checks           |
| `high/emit.ts`     | Inserter row placement, used transport entities, per-lane rates and copy multiplicity    |
| `high/solve.ts`    | State budget, candidate selection and independent validation                             |
| `solver.ts`        | Explicit `search`, `high`, or `auto` policy selection                                    |
| `result.ts`        | Shared result/diagnostic types, re-exported by `search.ts` for existing callers          |

Matching assigns each input to one of the available belt bits and enumerates output capacity covers
over the remaining belts. State includes occupied belt bits and the number of inserter cells
consumed on each side. Output covers reserve sites within those shared budgets and split production
in proportion to each selected belt's lane and inserter capacity. Each split then uses only the
sites required for its actual rate. Local capacity determines the required number of sites before
matching. This avoids enumerating resource lane subsets, fractional max-flow graphs, and discrete
inserter configurations. Near and far belts share one edge budget, so neither can claim cells needed
by the other. Emission assigns the near belt its required rows first and the far belt the remaining
rows, reversing the row preference in the lower half of a pair.

`pattern: 'single' | 'pair' | 'auto'` chooses which HIGH arrangements to try. Selection minimizes
rectangle area per machine, then transport entities per machine. Comparing per machine allows the
pair's density improvement to count. `optimal` applies only within this restricted family and its
selected pattern, including its equal input-lane split. `repeat.count` counts complete repeat units,
so a pair's lane load includes `2 × repeat.count` machines. `machineCopies` explicitly declares
homogeneous multiplicity; validation checks each assembler's item rates separately as well as
cumulative lane loads, fluid obligations, entity geometry and seams.

`solveKernelTileDesign` accepts `mode: 'search' | 'high' | 'auto'`, plus `pattern` and
`undergroundBeltReach`. Its default remains `search` for existing consumers. `auto` prefers a valid
HIGH result and spends any remaining state budget on the general search if HIGH fails. This is a
readability preference, with no cross-family area optimum. Pass the selected belt's
`undergroundLength - 1` as the hidden-cell reach; a 3×3 single needs five hidden cells and a pair
needs eight when central belts are used. Side-only subsets can succeed with shorter reaches.

The kernel workspace shows a third HIGH preview. Its custom problem has a single/pair/auto selector,
and Copy JSON includes the HIGH candidate and diagnostics. These previews use the selected belt's
actual underground reach. Existing factory-module consumers already count the placed assemblers and
consume `laneFlows`, so HIGH candidates use the same module conversion.

The debugger offers dataset machines grouped by footprint and physical fluid boxes, so upgrade tiers
with identical geometry share one building choice. Opening a recipe's Debug design retains its
actual machine prototype and geometry; an unavailable prototype produces a visible warning instead
of substituting a generic assembler. The connections table also tries each HIGH pattern using the
actual footprint, including the `2×2` electronics machines.

A local Node 24 microbenchmark, warmed up then averaged over twenty solves, illustrates the tradeoff
of the initial side-output implementation. With a 30 items/s belt, ordinary inserter capacity 8,
long capacity 4, and underground reach 8, six inputs at 2/s and one output at 2/s took about 1 ms
for HIGH versus 24 ms for the general search. The HIGH pair occupies 45 tiles per machine; the
general search found a compact 27-tile single while exhausting its 10,000-state budget. Adding one
200/s fluid input and allowing all orientations took about 1.7 ms for HIGH, which found a 10×10
pair; the general search used its 10,000 states in about 24 ms without finding a candidate. These
are examples, not a throughput guarantee or a full recipe survey. HIGH favors predictable geometry
and readable belt ownership; the general search remains useful for denser layouts and more flexible
lane allocation.

On the thirty existing Bob/Angel kernel examples with the same capabilities, the initial HIGH policy
found twenty designs in about 17 ms total, versus all thirty in about 1.24 s for the general search
in one local run. HIGH used 7,286 states versus 157,094. The ten remaining examples needed a
fallback, reinforcing the case for a separate policy rather than replacing the existing search.

End outputs also allow narrower subsets. Two inputs at 33.3/s and one output at 3.7/s, with a 75
items/s belt and ordinary inserter capacity 37.5, fit a 3×10 pair. All three belts pass beneath the
machines; each output lane carries 3.7/s from one assembler. The initial side-output policy required
a 5×10 pair for this case.

## Search and capacity

Base belt frames are ordered by rectangle area and belt entity count, then expanded into fluid route
and tunnel alternatives. Area pruning uses the whole routed rectangle. Within each frame, the search
assigns lane subsets to the most constrained demands first, including extra lanes when rate or
access requires splitting an item. It uses lane and reachable-base capacity bounds before solving
shared capacity. Resource and rule ordering are canonical. Fully exhausted item-capacity failures
are cached by belt columns and available inserter configurations within each search. Moving a fluid
trunk without changing item access therefore does not repeat the same impossible allocation. Valid
allocations, geometry-validation failures, and interrupted searches are not cached as capacity
failures.

`capacity.ts` uses a small deterministic fractional max-flow adapter:

`source -> demand -> assigned lane -> inserter configuration -> base -> sink`

Every lane belongs to one demand, preserving resource identity. Each base has one shared budget. A
relaxed flow that uses several configurations at a base causes discrete branching over those
alternatives. Once each used base has one configuration, the flow is an exact solution for this
restricted model. Removing used bases explores solutions with fewer inserters. This adapter is not a
general substitute for an LP when internal transport or resource-dependent capacities arrive.

Each lane's per-tile budget is `beltLaneCapacity / repeat.count`. Emission records actual per-lane
rates in `boundary[].laneFlows`, so module routing can supply/export each lane separately. The
independent validator reconstructs geometry, lane access, filters, rates, and repeat capacity.

The search minimizes rectangle area, then transport entity count; equal scores retain the first
canonical candidate. `maxStates` counts fluid route choices, tunnel choices, frame visits, lane
assignment/subset recursion, and discrete capacity branches. Diagnostics report explored states,
rejected capacity/validation checks, the best score, and the actual scope searched. Results
distinguish invalid input, unsupported rules, exhausted geometry/capacity bounds, and exhausted
search budget. A budget stop retains any valid incumbent with `optimal: false`. `optimal: true`
applies only to the reported route family. Tunnel profiles are generated to cross fluid
obstructions, not solely to replace otherwise unobstructed belts.

## Verification

`test/compute/tile-design/search.test.ts` covers mixed lanes, shared sites, long reach, filtered
products, rectangular rotation, catalysts, repeat limits, deterministic ordering, and honest budget
stops. A separate exhaustive allocator compares feasibility across 216 small integer-rate cases; it
enumerates demand splits between faces independently of the production flow/search code.

`test/compute/tile-design/fluid-search.test.ts` covers adjacent and remote trunks, rotations and
mirrors, rectangular half-cell geometry, multiple isolated networks, alternative and distinct box
obligations, four-inserter outputs around a blocked row, repeat/budget limits, and corrupted pipe or
belt certificates. It also covers the mono-silicon south-port adaptor, checks periodic fluid mixing,
and rejects disconnected labelled stubs.

`test/compute/tile-design/high.test.ts` compares emitted belt profiles with both HIGH JSON fixtures
and covers fluid branches, repeat seams, tunnel reach, per-copy demands, shared edge capacity, two
lanes on one input belt, rectangular and larger even-width machines (including the 4×4
electromagnetic plant), deterministic ordering, budget incumbents, mode fallback and existing
factory-module conversion.
