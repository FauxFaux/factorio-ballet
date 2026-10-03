# Debug grid routing

`src/compute/routing/debug.ts` adapts routing-debug URL state to the algorithm-independent
`RoutingInput` / `RoutingResult` contracts in `types.ts`. Exactly one source and one sink for an
item form a pair; incomplete or ambiguous items remain obstacles without acquiring paths. The
geometry is rasterized once. Entity arrows select their adjacent connection tiles, without
constraining the path's heading. Rates are retained in state but do not influence this geometric
search. Optional underground belts support straight tunnels; there are no shared belts or rate
allocation.

`solveConflictRouting` first computes independent A* paths. If these overlap, it tries whole-path
reservation in up to four distinct deterministic orders: cheapest independent path first, most
expensive first, canonical identity order, and reversed identity order. Each pass routes pairs in
sequence, blocking every cell of completed paths. The cheapest valid collection wins, with length
and bends breaking ties. A valid collection survives exhaustion of a later pass's allowance. This
avoids expensive cell-by-cell conflict branching on simple nested detours around obstacles.

When these priority orders fail, static conflict-based search starts from the independent paths. A
shared cell creates two branches, each forbidding that cell for one route. Only that route is
recomputed. Other provisional paths are not hard obstacles, and temporary reservation constraints do
not carry over from failed passes. Failed priority orders never prove infeasibility. All pairs'
endpoint cells are reserved up front, since another path cannot use them in a valid solution. A
shared endpoint between two pairs therefore proves failure immediately; a single pair can have a
zero-length path.

The bounded frontier uses focal selection: among collections within `costSlack` of the cheapest
cost, prefer fewer overlapping cell uses, then cost, length, bends, and creation order. Return a
valid collection immediately when one is found. This favors interactive feasibility and compactness;
it does not prove optimality or promise a suboptimality bound, including when `costSlack` is zero.
Identical per-route constraint sets reuse cached paths or exhaustive failures. Nodes share unchanged
paths and constraints, and conflict detection reuses stamped occupancy arrays.

Defaults allow 2,000,000 total A* expansions and 4,096 conflicting collection expansions. Budget
accounting includes reservation passes, which receive at most 50,000 expansions and one quarter of
the allowance remaining after independent routing, leaving work for the conflict-search fallback.
`maxReservationStates` controls this allowance; zero disables reservation passes. Setting `maxNodes`
to zero also skips these passes and only checks the independent paths. Budget stops return
`budget-exhausted`, never `no-solution`. Only exhaustive failures produce `no-solution`, and only
`found` results contain paths. Diagnostics retain the best provisional conflict count and an example
conflict when available. The UI displays only a complete valid collection. When the budget is
exhausted, it explains that routing may still be possible, shows the best attempt's remaining
overlaps and an example pair and cell, and suggests moving endpoints or reserved space. A
translucent red X marks the reported conflict cell for either an exhausted search or a proven
failure, without intercepting grid interactions.

The page's Routing search settings select reservations followed by conflict search (the default) or
conflict search alone, and configure all three budgets. `reservationFirst: false` skips the priority
passes while retaining their configured allowance for later use. Applying settings reroutes the
current geometry; editing drafts does not run the solver. Reset removes the overrides and restores
the defaults. Budgets accept nonnegative safe integers, including zero.

Requests are sorted by stable identities using code-point comparisons. Constraints, directions,
queue tie-breaks, and budgets are deterministic; there is no randomness, wall-clock deadline, or
dependency on previous solutions. User geometry and applied `routingOptions` are persisted in the
URL, without derived paths or diagnostics. `solveRoutingDebug` uses these stored options unless its
caller supplies an explicit options argument. Old links without options retain the defaults, and
unpacking a link reproduces the derived layout for the same implementation.

`findPath` accepts optional nonnegative `Float64Array` cell penalties. Each move costs one plus the
penalty at the entered cell; the start cell is not charged. It minimizes cost, then steps, then
bends. The global search uses the same summed objective. With absent penalties, cost equals steps
and the original shortest-path behavior is retained. The penalty array provides a future seam for
discouraged regions without a callback in the inner search loop; no hint UI or URL schema is added
yet. Required waypoints will need an extended low-level state and valid route geometry.

Underground moves consume alignment, entry, exit, and a straight step beyond the exit atomically.
Only entry, exit, and that final decision cell add surface occupancy. Immediate reversals are
impossible: the previous surface cell (or tunnel exit) is always occupied. Wider detours remain
legal, including three left turns followed by a tunnel beneath an earlier surface segment.
Zero-hidden-tile pairs are dominated by three surface steps with identical occupancy, cost, and
turns, and fewer pairs. Other clear tunnels remain available because they may cross the route's own
surface geometry or avoid penalties.

The underground A* state is cell and incoming heading. Its relaxed optimum is checked for repeated
surface cells and collinear tunnel overlap. A self-conflict creates two branches excluding either
offending atomic move, identified by alignment cell, direction, and length. Every valid path must
omit one of those moves, so this split preserves completeness. Replan each branch with cell/heading
A*, and visit branches in cost, steps, turns, and pair-count order to preserve optimality. All
replans share the expansion budget; exhaustion remains distinct from infeasibility. This replaces
the placement-history fallback, which enumerated whole occupied-cell and tunnel sets at every state.
Conflict branching can still be exponential on difficult geometry.

Run `node scripts/benchmark-routing.ts` for 1,000 seeded 16×12 obstacle grids, underground reach 5,
and a 20,000-expansion budget per route. The original history fallback used 300,339 expansions and
exhausted ten cases; reversal pruning and move-conflict branching used 38,410 expansions with no
exhaustions. Six additional cases found routes and four additional cases proved infeasibility.
Timing depends on the host; the deterministic expansion counts are the regression measure.

To try another global algorithm, implement `RoutingSolver` and supply it to `solveRoutingDebug`.
Normalization, UI results, and serialized state stay independent of that implementation. The seam is
one function call per solve, not a dispatch at every grid cell.

Tests compare feasibility with an independent exhaustive simple-path oracle for 756 small grids,
exercise a layout missed by both greedy pair orders, validate emitted geometry and scores, and cover
penalties, budget limits, deterministic ordering, tens of pairs, and URL round trips. The three-pair
shared-obstacle regression covers nearby source positions and transposed geometry, with work limits
that prevent a return to cell-by-cell branching for these straightforward detours.
