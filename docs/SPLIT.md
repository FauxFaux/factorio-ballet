# Decomposing a solved cell before layout

These rules turn a solved recipe graph into logical units before placing machines on a
two-dimensional grid. They are working design rules, not an automatic splitter specification. The
examples use [`cpu-15-1.cell.json`](../cpu-15-1.cell.json) and the transport kernels described in
[`blueprints/ASSEMBLERS.md`](blueprints/ASSEMBLERS.md).

A unit is a placement commitment: its machines and short internal routes should remain near one
another. It need not become a separately solved `Cell`, occupy one design column, or use one
blueprint kernel. Keep those decisions separate.

## Read the solved cell as a flow graph

Use one node per recipe entry and one network per material. Preserve fractional workloads and gross
rates from the solution. Round each recipe's workload up only when calculating installed machines;
rounding capacity must not create extra material demand or production.

Represent imports and exports as outside nodes. This matters for resources with several users:
nitrogen has one producer and two consumers, while imported silicon ingots have two consumers. Do
not turn either network into pairwise edges carrying the full rate, since that duplicates flow.

For each possible boundary record:

- material and item/fluid kind;
- total rate and direction;
- item trunk width at the selected belt capacity;
- number of local branches and their rates; and
- compatible temperature and fluid-box requirements for fluids.

Under the simple planning model used below, an item flow of rate `q` needs `ceil(q / beltCapacity)`
full-belt trunks and each distinct fluid needs one pipe. This is only a corridor estimate. A
concrete kernel must also satisfy lane, inserter, and port constraints.

## Grouping rules

Apply these as candidate generators, not as an ordered list of absolute laws. Keep several
non-dominated alternatives when the rules disagree.

### 1. Close small utilities and their disposal paths

Group a no-input source with its transformations and mandatory byproduct sinks when the result has
few outputs and a small footprint. A sink is part of producing the useful output, not an unrelated
consumer to place later.

This identifies compressed air, air separation, and oxygen voiding as one eight-machine nitrogen
utility. It has no material input, internally disposes of oxygen, and exposes only one nitrogen
pipe. It is a good custom design which may sit at an edge or corner of the eventual grid.

Prefer utility candidates with:

- no inputs, or one simple fuel/utility input;
- one useful output network;
- every unavoidable byproduct closed locally; and
- a footprint small enough that making it a custom block is cheaper than forcing it into a generic
  repeated stack.

### 2. Put an expanding transformation near its consumer

For a transformation `A -> B`, compare the transport width on both sides. If `B` is much wider than
`A`, carry `A` over the long distance and make `B` beside its consumer. For a compressing
transformation, normally do the reverse.

The CPU snapshot consumes mono-silicon at `19.09091/s` to make wafers at `252/s`. At `30/s` that is
one incoming mono-silicon belt versus nine wafer belts. Wafer machines therefore belong beside the
CPU assemblers, even though the two recipes need very different machine counts. The wide wafer flow
should be short and internal.

Evaluate the whole recipe interface when applying this rule. Moving wafers downstream does not make
platinum, nitride, sulfuric acid, or the CPU output disappear.

### 3. Gather siblings which share an outside supply

Recipes need not have a producer-consumer edge to deserve adjacency. If they are the only consumers
of an imported resource, a shared receiving block can remove a fork from the factory-wide trunk and
present smaller derived flows to the rest of the design.

Molten-silicon and silicon-powder production are the only silicon-ingot consumers. Together they are
three installed machines and consume all `38.48011/s` of ingots. Treat them as a strong candidate
for a small ingot-conversion hub, exporting molten silicon by pipe and powder on a belt.

Shared input alone is not enough to merge large branches. Count the routes saved, the fan-out still
required, and the distance to each output's consumer. A shared receiving edge can justify adjacency
without requiring both branches to become one independently solved cell.

### 4. Internalize tiny intermediate loops and feeds

Keep a low-rate intermediate with a consuming stack when that removes a dedicated boundary line. The
seed recipe uses only `0.28409` machine of work and its entire `2.98295/s` output feeds
mono-silicon. The default is therefore to put seed production with the 24 installed mono-silicon
machines, exposing molten silicon and nitrogen as inputs and mono-silicon as the output.

There is a legitimate alternative: seed production may sit next to the single molten-silicon machine
because both are tiny and both handle molten silicon. Preserve this as a layout alternative when
their fluid ports make a compact custom design possible. It creates a long seed route to the
mono-silicon stack, so prefer it only when the physical saving outweighs that extra boundary.

This illustrates a general tie-breaker: place a tiny producer with the consumer of its product
unless sharing a difficult fluid connection or machine-specific custom design is more valuable.

### 5. Co-locate consumers with wide or awkward feeds

After closing obvious chains, rank remaining handoffs by the cost of crossing a unit boundary:

```text
handoff cost ~= trunk width * expected distance
              + branch/merge cost
              + crossing and port penalties
```

This makes wafer-to-CPU the strongest solid-item co-location in this snapshot. It also makes
nitride-to-CPU a useful adjacency: `42/s` of nitride would otherwise cross the layout on two
30-item/s trunks, while powder feeding nitride is only `26.25/s` on one trunk. Put the nitride stack
on the CPU side of that transformation and carry powder to it.

Fluids have unlimited rate only in the simplified throughput model. A pipe still consumes a route,
needs a compatible machine port, may cross belts, and may have to branch. Never score it as free.

### 6. Use solved ratios to form repeated modules

Once recipes should be adjacent, derive module sizes from their solved workloads. Do not use the
JSON `ratio` field as a template ratio; derive ratios from the counts or assigned rates.

Nitride and CPU workload have the exact ratio:

```text
26.25 : 15 = 7 : 4
```

A natural finishing arrangement is therefore three full `7 nitride + 4 CPU` modules and one
remainder containing `5.25` nitride workloads in six installed machines beside three CPUs. This uses
the existing 27 installed nitride machines and 15 CPUs without adding capacity.

The remainder can be arranged as `NNN CC NNN C`, as suggested: six nitride machines distributed
around three CPU machines. It is a good local ordering, but not a ratio to repeat blindly. Repeating
`6 nitride + 3 CPU` five times would install 30 nitride machines, three more than the whole-cell
solution needs.

For every proposed module size:

1. allocate fractional workload to the copy;
2. round each recipe within that copy;
3. sum installed machines across all copies and the remainder;
4. reject or penalize extra machines and idle capacity; and
5. separately price its branches, merges, and shared trunks.

Exact small ratios are good seeds, not proof of a good floor plan. Enumerate nearby sizes and keep a
remainder rather than distorting every copy to avoid one.

### 7. Do not force every adjacent recipe into the same repeated tile

Wafer and CPU workload has the exact but relatively large ratio:

```text
27.272727... : 15 = 20 : 11
```

Splitting the CPUs as `4 + 4 + 4 + 3` and giving each module independent wafer capacity requires
`8 + 8 + 8 + 6 = 30` wafer machines. A shared wafer bank needs only 28. Prefer a wafer stack running
along the CPU modules, or compare one `20 wafer + 11 CPU` module plus an `8 wafer + 4 CPU`
remainder. Logical co-location does not require identical repetition boundaries.

The same distinction applies generally:

- a **unit** says which routes should remain local;
- a **stack** repeats one recipe using one transport kernel;
- a **module** combines adjacent stacks at a useful capacity ratio; and
- a **custom design** handles a small utility, awkward ports, or a remainder.

A unit may contain several stacks and a custom remainder. This hierarchy prevents a useful
co-location decision from manufacturing unnecessary machines.

### 8. Treat kernel feasibility as a hard gate

Only assign a stack to a kernel after its per-machine and cumulative rates are known. Follow the
checks in `ASSEMBLERS.md`:

- assign each solid ingredient to a dependable belt lane;
- keep every lane within `B / 2` unless explicit routing splits the item across lanes;
- account for the actual lane targeted by every output inserter;
- check cumulative rate at the end of a stack, not only one machine;
- check local inserter throughput separately from belt throughput;
- reserve every required fluid connection before solid infrastructure; and
- validate the periodic neighborhood, including underground pairs across module seams.

The CPU recipe has three solid inputs, one fluid input, and one solid output, so it topologically
resembles the `3s-1f-in-1s-out` kernel. Its per-machine rates are:

| Flow           | Rate/s |
| -------------- | -----: |
| Wafer input    |   16.8 |
| Platinum input |     14 |
| Nitride input  |    2.8 |
| Sulfuric acid  |     28 |
| CPU output     |   30.8 |

Topology is not capacity. On a `30/s` belt, the wafer input exceeds one lane's `15/s`, and the
one-sided output kernel can carry only `15/s`; even a full belt cannot carry one machine's `30.8/s`
output. On a `60/s` belt the one-sided output still fails narrowly at `30.8/s`. The fixed
two-assembler snake also lacks the fluid input required by this recipe. These facts do not forbid a
CPU stack; they require a different belt tier, lane pattern, fluid extension, or custom kernel.

The snapshot does not record selected machine prototypes, transport tier, inserter capabilities, or
fluid-box geometry. Grouping may therefore recommend adjacency, but it must label a concrete kernel
as unresolved until those choices are available.

### 9. Score the boundary and the inside

Minimizing cut edges always prefers one giant unit. Conversely, minimizing group size can create a
forest of branches and rounding waste. Compare candidates on at least:

- boundary resource count and trunk widths, separated into inputs and outputs;
- estimated route length for boundary trunks and local branches;
- installed machines, extra machines caused by repetition, and utilization;
- number of distinct stack and custom designs;
- approximate footprint and usable sides for ports; and
- likely crossings, merges, fan-out, and fluid/belt conflicts.

Internal transport does not become free when recipes share a unit. Estimate it using a candidate
stack/module arrangement. Keep a small Pareto set rather than hiding the tradeoff in one unexplained
score.

### 10. Defer two-dimensional choices, but preserve their requirements

Pre-layout decomposition should decide affinity and interfaces, not absolute coordinates. It should
still emit enough information for layout:

- recipes and allocated workloads in each unit;
- required stack/module candidates and custom remainders;
- boundary materials, rates, trunk widths, and preferred sides;
- internal high-volume handoffs which must remain short;
- shared networks which must branch to several units; and
- unresolved kernel, machine-port, or transport-tier requirements.

Do not infer unit membership from design columns. A unit may span columns, and one column may
contain several small custom units.

## Recommended decomposition for the 15-CPU snapshot

The following is a useful first plan, not a uniquely optimal partition:

| Unit                 | Installed machines | Local work                                      | Main boundary                                       |
| -------------------- | -----------------: | ----------------------------------------------- | --------------------------------------------------- |
| Nitrogen utility     |                  8 | compressed air, separation, oxygen void         | no input; nitrogen pipe out                         |
| Ingot conversion hub |                  3 | molten silicon, silicon powder                  | ingots in; molten pipe and powder belt out          |
| Mono-silicon stack   |                 25 | seed and mono-silicon                           | molten + nitrogen in; mono-silicon out              |
| Finishing campus     |                 70 | wafers, silicon nitride, processing electronics | mono, powder, nitrogen, platinum, acid in; CPUs out |

The finishing campus is intentionally a campus rather than one repeated module. Use:

- a shared 28-machine wafer stack along the CPU side, keeping `252/s` of wafers local;
- three `7 nitride + 4 CPU` neighborhoods;
- one custom `6 nitride + 3 CPU` remainder carrying only `5.25` nitride workloads; and
- shared platinum, acid, and CPU trunks sized for the whole campus, with short branches to each
  neighborhood.

This plan leaves three meaningful alternatives to compare during coarse layout:

1. Move seed production to the ingot-conversion hub if its molten-silicon plumbing is substantially
   cleaner there.
2. Attach powder production to the nitride stack instead of the ingot hub if one extra ingot branch
   is cheaper than the powder route.
3. Use the `20 wafer + 11 CPU` ratio to make two larger finishing modules if that routes better than
   a shared wafer bank.

At a planning belt capacity of `30/s`, the important whole-cell flows are:

| Material        | Rate/s | Full-belt trunks | Placement consequence                |
| --------------- | -----: | ---------------: | ------------------------------------ |
| Silicon ingots  |  38.48 |                2 | terminate once at the conversion hub |
| Silicon powder  |  26.25 |                1 | cheaper to carry than nitride        |
| Mono-silicon    |  19.09 |                1 | carry to the finishing campus        |
| Wafers          |    252 |                9 | keep inside finishing                |
| Silicon nitride |     42 |                2 | make beside CPU neighborhoods        |
| Platinum wire   |    210 |                7 | reserve a major external trunk       |
| Processing CPUs |    462 |               16 | reserve the dominant export edge     |

These are full-trunk estimates, not direct kernel capacities. Lane assignment may require more local
lines, while a different selected belt tier will change every item width and may rerank the
alternatives.

## Invariants for a future implementation

- Every original workload is allocated exactly once; split allocations sum to the original count.
- Regrouping does not change solved production rates.
- Installed capacity is rounded per independently buildable stack or module, never globally after
  discarding the copies.
- A producer's shared output is conserved across its consumers; fan-out does not duplicate supply.
- Boundary calculation preserves gross catalyst and return flows and fluid temperature.
- A proposed module distinguishes its local branches from its shared trunks.
- An infeasible or unverified kernel cannot be presented as buildable.
- The unchanged cell remains a baseline, and accepted affinity constraints survive recomputation.

Actually creating independently solved child cells is a later operation. The current solver would
otherwise rescale unpinned children independently. Until plan-wide solving or explicit boundary
contracts exist, these units should remain organizational and physical groupings within the one
solved cell.
