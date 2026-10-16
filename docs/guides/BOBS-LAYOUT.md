# Bob layout experiment

`+ bob layout` selects `CellLayout.type: 'bobs'`, persisted in the shareable URL. The ordinary
`+ layout` selects the existing rail/module surface. The Bob surface solves the cell directly; it
does not depend on finding belt kernels first.

The adapter in `src/compute/bobs/problem.ts` uses the solved gross input/output rates, including
fuel, returned catalysts, modules, and productivity. Each fractional machine count becomes that many
whole physical copies rounded up, with the final machine partially loaded. Rates are the solved
demand rather than the maximum possible production of all the rounded-up machines. Recipes with
fluids are allowed: all fluid connections are assumed correct. Fluid rates remain part of the cell's
production calculation, but are excluded from this layout's transport constraints and validation.
Fluid pipes and boundary connections consume no space; fluid-only machines are still placed.

## Geometry and capacity

All coordinates identify integer grid cells; pickup/drop points are their centres. Assemblers occupy
their dataset footprints and may rotate 90°. Chests and inserter bases each occupy one tile. Every
external item input has one source chest, and every external item output has one sink chest. All
those chests touch the solved rectangle's boundary. Optional relay chests may hold multiple
resources and have any number of incoming/outgoing inserters. Arms may cross other entities; only
their bases consume space.

Pickup and drop offsets each have Manhattan distance at most three from the inserter. The arm can
extend or retract at 0.1 tiles per tick (6 tiles/s at 60 ticks/s) while rotating at 2160°/s. The
angular distance is the shorter arc between the vectors; extension is the absolute difference
between their Euclidean lengths. One leg takes the longer of rotation and extension, since they
happen simultaneously. All 552 distinct endpoint pairs are precomputed with their cycle times and
capacities:

```
cycle seconds = 2 × max(swing degrees / 2160, arm length difference / 6)
items per second = 24 / cycle seconds
```

The return trip is included; pickup and drop take no time. This is continuous idealized timing,
without Factorio tick rounding or stack-size limits from the dataset. The smallest equal-length
swing between distinct tile centres is 36.87°, between `(2,1)` and `(1,2)`, giving about 703
items/s, which remains the highest capacity over all pairs. An equal-length opposite-side swing
carries 144 items/s. Pure extension from `(1,0)` to `(2,0)` carries 72 items/s. Multiple resources
can share one fixed pickup/drop pair, sharing its total capacity. There is no simulation of
inventory contents or startup seeds for cyclic/catalyst production; this is a steady-state flow
model with unbounded chest storage. Power poles and beacons do not occupy space in this experiment.

## CP-SAT model

`buildBobModel` in `src/compute/bobs/bobs-solver.ts` exposes the model and named variables for
inspection and further experiments. It jointly chooses entity positions, the bounding rectangle,
optional relay chests, optional inserter bases, their endpoints, and per-resource rates.
`addNoOverlap2D` packs their optional intervals. An allowed-assignment table enumerates legal arm
offsets and their capacities. Endpoint-selection literals constrain pickup/drop points to lie inside
their chosen assemblers/chests. No two endpoints of an inserter may name the same entity.

Each assembler has separate gross incoming and outgoing flow equations for every resource. Each
relay chest conserves every resource separately. Source/sink rates equal the cell's net boundary
demand. Flow capacities are shared across resources per inserter. Flows are integers in units of
0.001 items/s, with capacities rounded down. Tiny rounding differences on balanced internal edges
are reconciled at a producer. The independent validator checks emitted geometry, arm lengths,
capacity, boundary chests, gross machine rates, and chest flow conservation with that documented
rounding tolerance.

The objective minimizes width + height (half the perimeter), then the number of inserters plus relay
chests. Area is displayed but is not an objective. Chest and inserter ordering breaks permutation
symmetry. There is no fixed assembler grid, routing tree, or chest degree limit.

The default search is bounded by 32×32 tiles, at most eight relay chests, at most 64 inserters, and
ten seconds; smaller problems get smaller entity budgets. The controls can raise those bounds to
128×128, 32 relay chests, 128 inserters, and 120 seconds. The initial adapter caps problems at 24
assemblers. Feasible results may be suboptimal; an `optimal` result is optimal only within the
chosen bounds and model. A timeout with no incumbent says feasibility is unknown. An infeasible
result proves only that no layout fits the selected bounds.

## Browser hosting

The solver is dynamically imported and uses the package's worker executor to keep the page
responsive. Removing the layout, changing the cell, rerunning, or pressing Stop aborts the previous
job. Search settings/results are transient; only the layout type is persisted.

The [or-tools-wasm browser runtime](https://github.com/Axelwickm/or-tools-wasm#browser-requirements)
requires cross-origin isolation, even with one solver worker. Vite development and preview are
configured with these headers. Production hosting must also serve them on the page, for example in
the nginx location serving this application:

```nginx
add_header Cross-Origin-Opener-Policy same-origin always;
add_header Cross-Origin-Embedder-Policy require-corp always;
```

Serve emitted `.wasm` files with `application/wasm`. Missing isolation produces a visible error. The
package emits assets for its other solver runtimes as well, but those are not loaded by the Bob
search. The Bob solver module is excluded from page preloading.

Run `npx vitest run test/compute/bobs.test.ts test/components/bobs-layout.test.tsx` for the real
WASM solver and asynchronous surface regressions. The branching fixture pins entities and arms
through `buildBobModel` to check that a shared chest with three interacting inserters is feasible.
