# Debug grid routing

`src/compute/routing/debug.ts` adapts routing-debug URL state to the algorithm-independent
`RoutingInput` / `RoutingResult` contracts in `types.ts`. Exactly one source and one sink for an
item form a pair; incomplete or ambiguous items remain obstacles without acquiring paths. The
geometry is rasterized once. Entity arrows select their adjacent connection tiles, without
constraining the path's heading. Rates are retained in state but do not influence this geometric
search. There are no undergrounds, shared belts, or rate allocation.

`solveConflictRouting` uses static conflict-based search. Root paths are independent A* solutions; a
shared cell creates two branches, each forbidding that cell for one route. Only that route is
recomputed. Other provisional paths are not hard obstacles. All pairs' endpoint cells are reserved
up front, since another path cannot use them in a valid solution. A shared endpoint between two
pairs therefore proves failure immediately; a single pair can have a zero-length path.

The bounded frontier uses focal selection: among collections within `costSlack` of the cheapest
cost, prefer fewer overlapping cell uses, then cost, length, bends, and creation order. Return a
valid collection immediately when one is found. This favors interactive feasibility and compactness;
it does not prove optimality or promise a suboptimality bound, including when `costSlack` is zero.
Identical per-route constraint sets reuse cached paths or exhaustive failures. Nodes share unchanged
paths and constraints, and conflict detection reuses stamped occupancy arrays.

Defaults allow 2,000,000 total A* expansions and 4,096 conflicting collection expansions. Budget
stops return `budget-exhausted`, never `no-solution`. Only exhaustive failures produce
`no-solution`, and only `found` results contain paths. Diagnostics retain the best provisional
conflict count and an example conflict when available. The UI displays only a complete valid
collection. When the budget is exhausted, it explains that routing may still be possible, shows the
best attempt's remaining overlaps and an example pair and cell, and suggests moving endpoints or
reserved space. A translucent red X marks the reported conflict cell for either an exhausted search
or a proven failure, without intercepting grid interactions.

Requests are sorted by stable identities using code-point comparisons. Constraints, directions,
queue tie-breaks, and budgets are deterministic; there is no randomness, wall-clock deadline, or
dependency on previous solutions. Only user geometry is persisted in the URL, and unpacking it
reproduces the derived layout for the same implementation and options.

`findPath` accepts optional nonnegative `Float64Array` cell penalties. Each move costs one plus the
penalty at the entered cell; the start cell is not charged. It minimizes cost, then steps, then
bends. The global search uses the same summed objective. With absent penalties, cost equals steps
and the original shortest-path behavior is retained. The penalty array provides a future seam for
discouraged regions without a callback in the inner search loop; no hint UI or URL schema is added
yet. Required waypoints will need an extended low-level state and valid route geometry.

To try another global algorithm, implement `RoutingSolver` and supply it to `solveRoutingDebug`.
Normalization, UI results, and serialized state stay independent of that implementation. The seam is
one function call per solve, not a dispatch at every grid cell.

Tests compare feasibility with an independent exhaustive simple-path oracle for 756 small grids,
exercise a layout missed by both greedy pair orders, validate emitted geometry and scores, and cover
penalties, budget limits, deterministic ordering, tens of pairs, and URL round trips.
