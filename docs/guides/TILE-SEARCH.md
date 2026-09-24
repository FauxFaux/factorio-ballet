# Item tile search

`solveTileDesign` in `src/compute/tile-design/search.ts` implements the one-machine item allocation
milestone of `docs/ASSEMBLER-SOLVER-PLAN.md`. It consumes normalized fixed rates;
`normalizeTileDesignInput` remains the adapter from `KernelProblem`. Existing UI consumers still use
the legacy assembler generator.

The search supports any number of item ingredients and products that fit the available geometry and
capacities. It preserves gross input and output demands, including catalysts. Each gross transfer
must have a corresponding external supply or export. Internal recirculation, fluids, and multiple
machines return `unsupported`.

## Geometry and transport model

- Enumerate allowed rectangular footprint orientations and subsets of reachable straight vertical
  surface tracks. Northbound is canonical: reversing a straight belt just swaps its free lane
  variables in this model.
- Enumerate ordinary and long inserter bases on all four faces. Long inserters can stand either one
  or two cells from the edge, provided their machine endpoint lies inside the footprint. Ordinary
  and long configurations at the same base are alternatives.
- Straight trunks can serve east/west faces only. North/south access needs later item branches.
  Extra pitch and padding cannot improve this family, so pitch equals the rotated machine height.
- One resource and one external flow role per lane. Inputs can pick either lane; outputs use the
  actual far lane. Several inserters on one face do not unlock the other output lane.
- All supplied inserter rules currently describe filter-capable configurations with constant total
  throughput, shared across input resources. Identical reaches use the highest supplied capacity.
  Multiple products receive explicit output filters. Resource-dependent capacities or pickup
  scheduling require a richer rule model.

The track model exposes a surface profile separately from access options, capacity allocation, and
entity emission. Future bends, underground spans, and branches must supply their actual row
attachments and occupancy conflicts; an extra column alone does not promise extra access. The
belt-bending example in `docs/blueprints/ASSEMBLERS.md` is outside the current searched scope.

## Search and capacity

Frames are ordered by rectangle area and belt entity count. Within each frame, the search assigns
lane subsets to the most constrained demands first, including extra lanes when rate or access
requires splitting an item. It uses lane and reachable-base capacity bounds before solving shared
capacity. Resource and rule ordering are canonical.

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
canonical candidate. `maxStates` counts frame visits, lane assignment/subset recursion, and discrete
capacity branches. Diagnostics report explored states, rejected capacity/validation checks, the best
score, and the actual scope searched. Results distinguish invalid input, unsupported rules,
exhausted geometry/capacity bounds, and exhausted search budget. A budget stop retains any valid
incumbent with `optimal: false`. `optimal: true` applies only to the reported straight-trunk scope.

## Verification

`test/compute/tile-design/search.test.ts` covers mixed lanes, shared sites, long reach, filtered
products, rectangular rotation, catalysts, repeat limits, deterministic ordering, and honest budget
stops. A separate exhaustive allocator compares feasibility across 216 small integer-rate cases; it
enumerates demand splits between faces independently of the production flow/search code.
