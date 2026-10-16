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

## Placement and transport refinement

The application calls `solveBobLayout` in `src/compute/bobs/staged-solver.ts`. It separates machine
placement from transport rather than searching every arm's coordinates and flows jointly:

1. `placement.ts` packs assemblers and mandatory boundary chests with `addNoOverlap2D`, minimizing
   width + height, then reserved inserter/chest count. A throughput lower bound reserves enough
   total area for a minimum number of inserter bases. This is an area allowance, not a guarantee
   that the free tiles are accessible.
2. `transport.ts` fixes those rectangles and enumerates concrete inserter base/source/destination
   candidates on free tiles. It first tries direct connections, then relay budgets of one, two,
   four, and so on up to the configured maximum. One-chest searches omit impossible chest-to-chest
   connections, avoiding the much larger relay-chain model for simple routes. All tiles outside
   assemblers and boundary chests are eligible inserter/relay positions. A tile can hold at most one
   inserter or chest. Relay chests conserve each resource and have no degree limit.
3. A transport candidate's capacity is the maximum over its legal endpoint pairs. Because arms and
   endpoints consume no extra space, exact endpoints can be selected after flows are known. We keep
   the capacity/reach Pareto frontier, then select the shortest endpoint pair that carries the
   assigned load. The transport objective minimizes inserter plus chest count, followed by a soft
   preference for short reach. Its reach score uses each candidate's minimum possible reach; it does
   not prove that the emitted layout has globally minimum arm lengths.
4. A failed transport search ranks ports by capacity deficits and scarcity of candidate bases. Up to
   two new ports are promoted into the next placement model, which places their actual inserter
   bases, endpoints, and sufficient capacity together with the machines. Reservation slots are
   optional and share flow constraints: one physical inserter can satisfy promoted ports at both
   ends and carry multiple resources. A promoted port may need multiple parallel inserters. Optional
   reserved relays let those inserters connect indirectly. The transport pass uses these arms and
   relays as hints, allowing reuse, rewiring, or removal instead of locking in duplicate arms or an
   unhelpful relay topology. The completed transport replaces the reservation list; it is not
   appended to it. If the reservations cannot be packed, the newest promotions are relaxed.
5. Failed machine/chest arrangements are excluded from later placement attempts. The solver first
   retries the same perimeter with promoted connections, then increases its minimum perimeter after
   two failed placements. At fixed maximum bounds it continues rearranging within those bounds.

Each assembler has separate gross incoming and outgoing flow equations for every resource, so
returned catalysts cannot disappear by netting their rates. Boundary flows equal the cell's net item
demand. Multiple resources share each inserter's total capacity. Flows are integers in units of
0.001 items/s, with capacities rounded down. Tiny rounding differences on balanced internal edges
are reconciled at a producer. The independent validator checks every completed layout's geometry,
boundary chests, reach, capacity, gross machine rates, and relay conservation.

Every successful placement solve publishes a snapshot immediately, before transport runs. The
surface keeps these snapshots as selectable attempts, updates their transport outcome, and draws red
dashed tiles around the ports implicated in a failure. Capacity-deficient ports have a local
capacity bound; routing conflicts and timeout regions are explicitly candidate bottlenecks, not
minimal unsatisfiable cores. Earlier failed placements remain available after a later success,
search failure, or Stop. A new search starts a fresh attempt history. History and results are
transient and are not included in the URL.

The default bounds remain 32×32 tiles, at most eight relay chests, at most 64 inserters, and ten
seconds; smaller problems have smaller entity budgets. Controls allow 128×128, 32 relay chests, 128
inserters, and 120 seconds. There are at most 24 assemblers. The wall-clock budget is shared across
placement, candidate enumeration, and transport. Refinements continue until a valid layout is found,
Stop is pressed, or the time budget expires; there is no limit on the number of refinement rounds.
Individual placement solves receive at most one second and transport solves at most 1.5 seconds; the
remaining shared budget can shorten those slices. Candidate enumeration yields periodically and
checks cancellation and the deadline.

This is a heuristic for compact feasible layouts. Completed item layouts report `feasible`, even
when each individual SAT solve proved its own optimum. Fluid-only packing can still report
`optimal`. Only an initial packing impossibility or an unconditional inserter-throughput lower bound
reports `infeasible`. Failure of the refinement search reports `unknown`; it is not proof that the
original problem has no solution.

`buildBobModel` in `src/compute/bobs/bobs-solver.ts` retains the original joint model for inspection
and experiments. The application does not use it to solve layouts. `buildBobPlacement` and
`buildBobTransport` expose the two new models for focused experiments. `buildBobTransport` defaults
to fixed reservation geometry for experiments; the application passes the `hints` reservation mode
described above.

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

Run
`npx vitest run test/compute/bobs.test.ts test/compute/bobs-staged.test.ts test/components/bobs-layout.test.tsx`
for the real WASM solver and asynchronous surface regressions. The branching fixture pins entities
and arms through `buildBobModel` to check that a shared chest with three interacting inserters is
feasible.
