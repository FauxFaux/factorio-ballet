# Tileable assembler blueprints

This note describes the solid-item transport pattern demonstrated by `ass-3s-in-1s-out.base64`, its
one-fluid extension in `ass-3s-1f-in-1s-out.base64`, and the rectangular chemical-plant pattern in
`chem-2f2s-in-1f1s-out.base64`. It also records the compact two-assembler snake in
`ass-2s-in-1s-out-snake.base64`, the port adaptor in `mono-silicon.base64`, and the alternating
mirrored-plant arrangement in `chem-flippos.base64`. The matching JSON files are easier to inspect
and are the authoritative entity lists. `more-inserters-in-wiggle.json` illustrates a way to
increase input inserter throughput along one machine edge. `three-piping-plans.json` compares three
ways to fit a fluid pipe and belt transfers along one assembler edge.

The filename counts describe transport lines, not resource types: `s` is one solid belt and `f` is
one independent fluid pipe. A solid belt has two lanes and can therefore carry two dependable item
types under the one-item-per-lane rule used here.

These fixtures illustrate transport geometry rather than complete factories. The mono-silicon
fixture sets a recipe on each machine; the others do not. None includes filters, modules, or circuit
conditions. Only the snake includes a power pole.

| Fixture                  | Machines per tile | Tile size | Repeat vector | Inputs                  | Outputs                                       | Intended use             |
| ------------------------ | ----------------: | --------- | ------------- | ----------------------- | --------------------------------------------- | ------------------------ |
| `ass-3s-in-1s-out`       |                 1 | 9x3       | `(0,3)`       | 3 solid belts           | 1 solid belt, one lane populated              | generator template       |
| `ass-3s-1f-in-1s-out`    |                 1 | 10x3      | `(0,3)`       | 3 solid belts, 1 fluid  | 1 solid belt, one lane populated              | generator template       |
| `chem-2f2s-in-1f1s-out`  |                 1 | 15x3      | `(0,3)`       | 2 solid belts, 2 fluids | 1 solid belt with one lane populated, 1 fluid | geometry reference       |
| `mono-silicon`           |                 1 | 6x4       | `(0,4)`       | 2 fluids                | 1 solid belt, one lane populated              | port adaptor reference   |
| `ass-2s-in-1s-out-snake` |                 2 | 7x6       | `(0,6)`       | 2 solid belts           | 1 solid belt, both lanes populated            | fixed validation fixture |

The table gives normalized reusable-tile dimensions. A finite fixture may include boundary plumbing
outside those dimensions, as the chemical-plant example does.

## Coordinates and directions

Use integer tile cells internally. A one-tile blueprint entity in cell `(x, y)` has a serialized
centre of `(x + 0.5, y + 0.5)`. A machine with top-left cell `(x, y)` and size `w x h` has a
serialized centre of `(x + w / 2, y + h / 2)`. A final translation may place this local layout
anywhere in a blueprint.

The cardinal Factorio directions used here are:

| Direction | Value | Vector |
| --------- | ----: | ------ |
| north     |     0 | `0,-1` |
| east      |     4 | `1,0`  |
| south     |     8 | `0,1`  |
| west      |    12 | `-1,0` |

An inserter picks up on the side named by its direction and drops on the opposite side. A normal
inserter reaches one tile from its base. A long-handed inserter reaches two tiles from its base.

## The `3s-in-1s-out` transport kernel

Normalize the fixture's top-left corner to `(0, 0)`. Its occupied rectangle is 9x3 cells and its
machine occupies `(3, 0)` through `(5, 2)`. In the diagram, `I` is an input belt, `O` is the output
belt, `i` is a normal input inserter, and `L` is a long-handed inserter.

```text
        x=0  1  2    3  4  5    6  7  8
y=0      I^ I^  .   [A  A  A]   . I^ Ov
y=1      I^ I^  L-> [A  A  A] ->L I^ Ov
y=2      I^ I^  i-> [A  A  A] <-i I^ Ov
```

The four belt columns and their transfers are:

| Role            | Belt column  | Inserter base | Reach | Transfer        |
| --------------- | ------------ | ------------- | ----- | --------------- |
| far-west input  | `x=0`, north | `(2,1)`, west | 2     | belt to machine |
| near-west input | `x=1`, north | `(2,2)`, west | 1     | belt to machine |
| near-east input | `x=7`, north | `(6,2)`, east | 1     | belt to machine |
| far-east output | `x=8`, south | `(6,1)`, west | 2     | machine to belt |

The asymmetry in the output inserter's direction is intentional: its pickup is two cells west, in
the machine, and its drop is two cells east, on the output belt.

Every belt column has one segment in each of the three rows. Translating the whole kernel by
`(0, -3)` places an identical assembler immediately above it without overlap. The northbound input
belts and southbound output belt meet the corresponding belt in the neighbouring copy. Repeating the
translation by any integer multiple of three therefore produces one vertical column of assemblers
with four continuous belt lines.

This gives two separate tileability conditions:

1. Entity footprints in one kernel must stay within its three-row pitch.
2. Each boundary-crossing belt must occupy both boundary rows and point in the same direction in
   every copy.

Merely avoiding collisions is insufficient: omitting a boundary belt segment leaves adjacent copies
visually aligned but disconnected.

## Smaller solid patterns

An input belt and its feeding inserter form a removable pair. Remove all three belt segments in the
column, not just the segment beside the inserter, so the generated blueprint does not advertise an
unused through-line.

- For two input belts and one output belt, remove the far-west input column (`x=0`) and the
  long-handed input inserter at `(2,1)`. The two remaining inputs are the near-west and near-east
  belts.
- For one input belt on the left and one output belt on the right, also remove the near-east input
  column (`x=7`) and its inserter at `(6,2)`. Retain the near-west input (`x=1`) and far-east output
  (`x=8`).
- Other subsets are geometrically valid, but stable generation should choose one canonical subset
  for each input-belt count so equivalent specifications produce the same blueprint.

Each input belt has two lanes, and its inserter can pick from either lane. The dependable baseline
is therefore one item type per lane: one input belt can supply up to two distinct solid ingredients,
two belts up to four, and three belts up to six. Putting two item types on the same lane creates a
mixed lane whose ordering and availability cannot be inferred from geometry alone.

The single output inserter always drops onto one particular lane. Consequently, this kernel has only
half a belt of usable output throughput even though the other lane physically exists. Using both
output lanes would require another output inserter, alternating/mirroring kernels, or a later
lane-balancing pattern.

## Bending a belt for more short-reach inserters

`more-inserters-in-wiggle.json` shows two southbound input belts beside the five-tile west edge of
an induction furnace. The fixture uses ordinary inserters, one in each row; the throughput benefit
comes from being able to use bulk inserters at all five sites. Relative to the fixture, the furnace
occupies columns `3..7`, the inserters occupy column `2`, and the belts normally run in columns `0`
(far) and `1` (near):

```text
row 0:  far belt ↓   near underground input   inserter → furnace
row 1:  far belt →   far belt ↓               inserter → furnace
row 2:      ·        far belt ↓               inserter → furnace
row 3:  far belt ↓   far belt ←               inserter → furnace
row 4:  far belt ↓   near underground output  inserter → furnace
```

The near belt enters an underground section at row 0 and resurfaces at row 4. While it is
underground, the leftmost (far) belt bends inward to column `1` for three rows, then bends back. The
inserters in rows `1..3` pick up from that temporarily near far belt; the inserters in rows `0` and
`4` pick up from the exposed underground-belt endpoints of the original near belt. Thus both
independent belts remain continuous, and all five pickup positions are only one tile from their
inserters.

With straight belts at the same positions, the near belt offers two short-reach pickup sites and the
far belt needs three long-handed inserters. The bend changes a possible `2 bulk + 3 long-handed`
arrangement into `2 bulk + 3 bulk`, which can provide substantially more transfer capacity where
inserter throughput is the constraint. Actual rates still depend on the inserter prototypes and
whether the two belt lanes can supply the items quickly enough.

The inward run need not be three tiles long. A two-tile bend can give a four-tile-high machine two
short-reach inserters on each belt. Along a five-tile edge, shifting the underground endpoints and
the two-tile bend leaves three sites on the normally near belt and gives two sites to the normally
far belt while it is temporarily near. The principle is to allocate the available edge rows between
exposed near-belt segments and the far belt's inward run.

## Three ways to share an assembler edge with a pipe

`three-piping-plans.json` places three separate assembling-machine-2 examples from top to bottom.
Only the left side of each assembler is populated. Each example occupies three rows, has a
northbound belt, and connects a pipe to the middle of the assembler's west edge. The inserter
directions below describe the fixture; a free inserter site could serve either role.

| Example | West-to-east arrangement                                    | Inserters in the fixture                 | Tradeoff                                                                                                                                                                                                                                                                                                   |
| ------- | ----------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top     | belt, empty cell, long inserters, pipe, assembler           | top and middle feed in; bottom takes out | The inserters stand outside the surface pipe and reach across it into the machine. The belt is two cells beyond their bases. This mainly demonstrates that a long inserter can transfer across a pipe.                                                                                                     |
| Middle  | pipe trunk, underground belt, ordinary inserters, assembler | top and bottom take out                  | A straight pipe trunk runs vertically. A pipe-to-ground pair occupies the middle row between the trunk and the assembler. The belt passes underneath one pipe endpoint, leaving its exposed endpoints for ordinary inserters. This compact arrangement is useful and is sometimes produced by the solvers. |
| Bottom  | belt, pipe trunk, long inserters, assembler                 | top takes out; bottom feeds in           | A surface pipe runs between the belt and inserter bases. The middle-row pipe branches to the assembler. No underground pipes or belts are needed, but the long inserters make this a low-throughput choice.                                                                                                |

In the top example, the pipe itself runs vertically in the cell immediately beside the assembler;
the long inserters stand on its far side. In the bottom example, the inserters stand immediately
beside the assembler, with the pipe between them and the belt. A long inserter reaches two cells on
each side of its base, so both placements work despite the intervening pipe.

The bottom arrangement gets built in real games because underground pipes and belts cost more. Its
long inserters transfer items much more slowly than ordinary inserters, so it suits modest item
rates. The middle arrangement spends underground entities to keep ordinary inserters at the machine
edge. In all three examples, the fixture shows geometry and transfer directions, not a measured
throughput guarantee for a particular recipe.

## Choosing a pattern from item rates

Counts per craft determine rates; rates determine transport. For a proposed run of `n` repeated
tiles, compute the per-second rate of every solid ingredient and product for every assembler after
machine speed, modules, and productivity have been applied.

For a belt whose `itemsPerSecond` is `B`, treat each lane as a bin of capacity `B / 2`:

1. Sum the rates of the assemblers in one tile, respecting which lane each output inserter targets,
   then multiply by `n` to obtain the peak rate at the end of the repeated belt.
2. Assign each input item to one lane. Do not split an item across lanes unless the generated
   upstream routing also performs that split.
3. Use the smallest canonical input pattern whose lane assignment fits. Reject the three-input-belt
   kernel if more than six distinct solid inputs are required or if the rates do not fit its six
   lanes.
4. In the one-assembler kernels, require the solid output to fit `B / 2`, because all copies insert
   onto the same lane. A pattern proven to populate both lanes, such as the snake, may use `B` in
   total, but each lane must still fit `B / 2` independently.
5. Separately check the local transfer rate through every inserter. Belt capacity does not prove
   that an inserter can move the required items between a belt and one assembler.

The repository already ingests full-belt throughput as `Belt.itemsPerSecond` and models lanes in
`src/bp/belt.ts`. It does not currently ingest inserter rotation speed, hand stack size, or
prototype reach. Automatic generation must add or otherwise provide those capabilities before it can
make a rate guarantee. Until then it can prove belt feasibility but not inserter feasibility.

The baseline also assumes exactly one solid product. An unfiltered output inserter cannot provide a
deterministic lane assignment for several distinct products. Multi-product recipes need filtered
inserters and/or additional output lines and are a different pattern.

## Machine size, rotation, and fluid ports

The fixture proves the arrangement for a north-facing 3x3 machine. A generator should construct a
layout in local coordinates and rotate the complete result, rather than maintaining four unrelated
templates. A quarter-turn transforms entity positions, swaps a non-square machine's width and
height, and advances each cardinal direction by `4` modulo `16`. Machine fluid-box connection points
must undergo the same transform.

For a different machine footprint, derive inserter sites from its occupied edge cells. A normal
inserter base is immediately outside an edge and its belt is one cell farther out. A long-handed
base can use that same outside row or column while reaching a belt two cells away. The tiling pitch
must be large enough for the rotated machine and for the distinct inserter sites selected on its
edge; it is three in this fixture, but should not be hard-coded for every machine.

Reserve every fluid connection which the recipe actually uses before placing solid infrastructure. A
required connection needs its outside pipe cell and a route to the repeating boundary. Inserters may
move to another free edge cell without changing which belt column they serve. If a pipe must cross a
through-belt, use a matched underground-belt pair or move the belt; never silently occupy the pipe
cell.

### The `3s-1f-in-1s-out` extension

`ass-3s-1f-in-1s-out.json` adds one fluid input while retaining the three solid inputs, one solid
output, and three-row tiling pitch. Normalize it to the same `(0, 0)` origin as the solid-only
kernel. The machine still occupies `(3, 0)` through `(5, 2)`, but the occupied rectangle grows from
9x3 to 10x3 to make room for a vertical pipe trunk at `x=9`.

The unchanged entities are the two west input belts and inserters, the near-east input belt and
inserter, and the assembler. The east side changes as follows:

| Entity                      | Position   | Direction/type | Purpose                                                        |
| --------------------------- | ---------- | -------------- | -------------------------------------------------------------- |
| long-handed output inserter | `(6,0)`    | west           | moves the product from the machine to `(8,0)`                  |
| underground output belt     | `(8,0)`    | south/input    | accepts the product and enters the tunnel                      |
| underground output belt     | `(8,2)`    | south/output   | emerges and continues toward the next tile                     |
| machine-side pipe-to-ground | `(6,1)`    | west           | its exposed side touches the middle of the machine's east edge |
| trunk-side pipe-to-ground   | `(8,1)`    | east           | pairs with `(6,1)` and exposes fluid to the east               |
| ordinary pipes              | `(9,0..2)` | none           | form the repeating vertical fluid trunk                        |

This arrangement contains two independent underground crossings:

1. The pipe-to-ground pair runs horizontally from `x=6` to `x=8` in row 1. It passes beneath the
   northbound near-east input belt at `(7,1)`.
2. The southbound output belt runs underground from `(8,0)` to `(8,2)`. It passes beneath the
   trunk-side pipe-to-ground at `(8,1)`.

The two tunnels intersect at `(8,1)` without placing two surface entities in that cell: the
pipe-to-ground is the surface entity and the belt is below ground. The long-handed output inserter
moves from row 1 to row 0 so that `(6,1)` is available for the machine-side pipe-to-ground. It still
reaches two cells west into the assembler and two cells east onto the output belt input.

The three ordinary pipes at `x=9` are as important to tiling as the belt boundary segments. When a
copy is translated by `(0, -3)`, its bottom pipe is cardinally adjacent to the next copy's top pipe.
All tiled assemblers therefore share one continuous vertical fluid network. Fluid pipes are not
directional, so the trunk may be supplied from either end; every tiled branch must carry the same
fluid.

The fixture's selected fluid connection is in the middle of the machine's east edge. The
machine-side pipe-to-ground is immediately outside that edge and faces west, directly into the
connection. For a rotated assembler, first rotate its centre-relative fluid-box connection points,
then derive the occupied edge and outward normal. A pipe-to-ground which connects directly to the
machine belongs in the first cell outside that edge and faces inward.

A middle-edge connection may begin on any cardinal edge, but this exact routing directly implements
the east-edge case. For a square assembler whose rotation is selectable, rotate the machine so the
chosen connection faces east and retain the rest of the kernel. If its rotation is fixed, route the
branch from the transformed edge to a vertical trunk without occupying an inserter, belt, or the
next three-row tile. A north- or south-edge connection generally needs a larger tiling pitch or a
different branch route because the first outside cell lies across the current vertical tile
boundary.

The underground endpoints are functional pairs, not interchangeable decorations. A generator must
check that both members have the same prototype, lie on one axis, face the required opposing ways,
and are within that prototype's underground distance. It must make the equivalent reach check for
the underground belt pair using `Belt.undergroundLength`.

### Two solids and one fluid in, one solid and one fluid out

The generator supports a 10x3 tile for a 3x3 machine with opposing middle-edge fluid ports. From
west to east, its columns are a fluid trunk at `x=0`, a northbound underground input belt at `x=1`,
a northbound input belt at `x=2`, input inserters at `x=3`, the machine at `x=4..6`, output
inserters at `x=7`, a southbound underground output belt at `x=8`, and a fluid trunk at `x=9`.

The left fluid branch connects underground-pipe endpoints `(1,1)` and `(3,1)`, crossing the near
input belt at `(2,1)`. The right branch connects `(7,1)` and `(8,1)`. Both underground belts have
surface endpoints in rows 0 and 2, leaving row 1 for their respective fluid branches. The far input
belt is read by a long-handed inserter at `(3,0)`; the near belt is read by a normal inserter at
`(3,2)`. Normal output inserters occupy `(7,0)` and, when needed, `(7,2)`.

If neither solid input fits the long-handed inserter's transfer rate, both can share the near belt
when their combined rate fits its two lanes and two normal inserters. In that case the far input
belt is omitted and the normal input inserters occupy `(3,0)` and `(3,2)`.

### The rectangular `chem-2f2s-in-1f1s-out` pattern

`chem-2f2s-in-1f1s-out.json` contains two complete copies of a more complicated repeating unit. The
second chemical plant and all of its transport entities are translations of the first by `(0, 3)`.
Each branch-oriented copy has 28 entities. Grouping every underground endpoint with the machine
branch that motivated it makes that copy appear to protrude beyond its three rows, but entity
ownership is only a human convention: the blueprint format has no such grouping. Reassigning each
seam endpoint to the adjacent spatial tile gives a regular 15x3 repeating rectangle.

For the first copy, take the corner immediately left of blueprint position `(2.5, 21.5)` as local
`(0, 0)`. Its chemical plant faces east, has centre `(6.5, 1.5)`, and occupies cells `(5,0)` through
`(7,2)`. The solid transport is:

| Role                  | Geometry                                                              |
| --------------------- | --------------------------------------------------------------------- |
| far-west solid input  | northbound belt at `x=2`, read by the long-handed inserter at `(4,1)` |
| near-west solid input | northbound belt at `x=3`, read by the normal inserter at `(4,2)`      |
| east solid output     | southbound belt at `x=9`, fed by the normal inserter at `(8,1)`       |

The plant uses three of its four rotated corner fluid connections. Each branch begins with a
pipe-to-ground immediately outside the plant, tunnels beneath the solid belts, and reaches its own
vertical trunk:

| Fluid role | Plant-side endpoint | Trunk-side endpoint | Branch pipe | What it crosses             |
| ---------- | ------------------- | ------------------- | ----------- | --------------------------- |
| input A    | `(4,0)`, east       | `(1,0)`, west       | `(0,0)`     | both input belts at `x=2,3` |
| input B    | `(8,0)`, west       | `(11,0)`, east      | `(12,0)`    | the output belt at `x=9`    |
| output     | `(8,2)`, west       | `(13,2)`, east      | `(14,2)`    | the output belt at `x=9`    |

The unused west-lower fluid connection coincides with the solid-input inserter site at `(4,2)`.
Generation must select connection points that the recipe and machine allow before it claims those
cells for inserters.

The three fluid trunks use different row phases:

- Input A's trunk is at `x=0`. Its branch pipe is in row 0, with pipe-to-ground endpoints at
  `(0,-1)` facing south and `(0,1)` facing north.
- Input B's trunk is at `x=12`. Its branch pipe is also in row 0, with endpoints at `(12,-1)` and
  `(12,1)`.
- The output trunk is at `x=14`. Its branch pipe is in row 2, with endpoints at `(14,1)` facing
  south and `(14,3)` facing north.

The vertical trunks are continuous across copies through underground pairs rather than adjacent
ordinary pipes. For example, the first copy's lower Input A endpoint at `(0,1)` pairs with the next
copy's translated upper endpoint at `(0,2)`. The first copy's lower fluid-output endpoint at
`(14,3)` similarly pairs with the next copy's upper output endpoint at `(14,4)`. Input B follows the
same phase as Input A. These are three independent pipe networks and must never be joined.

#### Rectangular ownership of seam endpoints

The fixture's original branch-oriented grouping associates the two input endpoints in row `-1` and
the output endpoint in row 3 with the machine in rows `0..2`:

```text
row -1: input-A endpoint at x=0; input-B endpoint at x=12
rows 0..2: belts, inserters, plant, horizontal fluid branches, and branch pipes
row  3: fluid-output endpoint at x=14
```

For generation, use the simpler spatial convention: a tile owns every entity whose centre is in its
half-open three-row rectangle. The endpoint at `(14,3)` belongs to the tile below, where it is row
0; the endpoints at `(0,-1)` and `(12,-1)` belong to the tile above, where they are row 2. Under
this ownership, one 15x3 tile contains 28 entities:

| Trunk                | Row 0                                        | Row 1                 | Row 2                                       |
| -------------------- | -------------------------------------------- | --------------------- | ------------------------------------------- |
| input A, `x=0`       | branch pipe                                  | north-facing endpoint | south-facing endpoint for the machine below |
| input B, `x=12`      | branch pipe                                  | north-facing endpoint | south-facing endpoint for the machine below |
| fluid output, `x=14` | north-facing endpoint from the machine above | south-facing endpoint | branch pipe                                 |

The remaining entities—the two input belts, output belt, inserters, chemical plant, and horizontal
fluid branches—already lie in rows `0..2`. This produces one ordinary rectangular entity set which
can be translated by `(0,3)` without special overlap rules.

The exterior endpoints in the finite two-machine fixture are boundary plumbing left by the original
branch-oriented grouping. They show how the first and last fluid branches are capped, but they need
not be considered part of the reusable interior tile. In an indefinitely repeated layout, the same
physical endpoints are simply owned by the neighboring 15x3 rectangle.

For a candidate rectangular unit `U` and translation vector `t`, validate at least `U-t`, `U`, and
`U+t`:

1. No translated surface footprints overlap.
2. Every solid belt has the intended surface connection across the seam.
3. Every fluid seam endpoint pairs with the intended endpoint in the neighboring copy.
4. No underground endpoint instead pairs with a nearer compatible endpoint from the wrong branch or
   copy.
5. Underground spans remain within the selected belt or pipe prototype's reach.

When emitting several copies, generate each rectangular tile's owned entities once. Add boundary
plumbing only at the ends of a finite run when it is needed to complete an underground pair; do not
emit the same seam endpoint from both neighbors. This convention makes collision checks, clipping,
and an `n`-copy entity count much easier to reason about than the fixture author's branch-oriented
grouping.

The machine model retains fluid boxes as groups, their production modes, and each physical
connection's flow mode and direction. Recipe fluids retain their optional 1-based, side-specific
`fluidboxIndex`, so a generator can map two independent fluid inputs and one fluid output onto the
chemical plant's four physical connections. Geometry alone is still not a safe substitute for that
mapping.

### Alternating mirrored plants: `chem-flippos`

`chem-flippos.json` places six north-facing 3x3 `angels-chemical-plant-2` machines in one touching
row, with centres three tiles apart. All run `angels-air-separation`. Machines 1, 3, and 5 have
`mirror: true`; machines 2, 4, and 6 omit it. Their north-side fluid inputs meet one continuous pipe
row. Their two south-side fluid output ports are two tiles apart on each machine, so routing both
outputs through a row of touching, identically oriented plants would crowd the same narrow strip
below them.

Mirroring every other plant exchanges the _physical positions_ of its two output fluid boxes. A
given product uses the left output port on one plant and the right output port on its neighbour. At
alternating boundaries, one product's matching ports face each other just one tile apart; at the
next boundary, the other product's ports do. The fixture uses ordinary pipes for the short
connections and pipe-to-ground pairs to carry the separate output networks past one another. The
fixture has 34 pipes and 13 pipe-to-ground entities, including plumbing at the ends of this finite
six-plant row. It is not a single rectangular tile to copy verbatim.

This alternating mirror is the preferred dense arrangement when a machine has two fluid input or
output ports at a two-tile pitch and the same fluids must serve a tightly packed row. Apply the
reflection to the machine's fluid-box connections and keep the recipe-to-box assignment attached to
the reflected boxes; merely mirroring the pipe drawing would connect the wrong fluids. A generator
should use a two-machine repeat unit, since a one-machine translation does not preserve the port
assignment, and verify that the two fluid networks stay separate across repeated units. The same
principle applies to two input ports when the recipe and machine permit the corresponding mirrored
assignment.

### Adapting a fluid port: `mono-silicon`

`mono-silicon.json` contains two mirrored, east-facing 3x3 `angels-casting-machine-3` machines
running `angels-mono-silicon-seed`. The recipe takes two fluids and produces one solid item. The
machine centres are `(189.5,388.5)` and `(189.5,392.5)`, four rows apart. Their output inserters
drop west onto the northbound belt at `x=186.5`; there is no solid input belt. The two fluid inputs
cannot both be connected directly on one machine edge.

Use the first machine's top-left cell as local `(2,0)`. Its belt is at `x=0`, output inserter at
`(1,1)`, and machine at `x=2..4`, `y=0..2`. One fluid route uses the east-side pipe-to-ground at
`(5,1)`, with a pipe at `(5,2)` and another pipe-to-ground at `(5,3)`. The other route leaves the
machine's lower edge through the ordinary pipe at `(2,3)`, turns west through `(1,3)`, and reaches
the west-side pipe-to-ground at `(1,2)`. The fixture also places a west-side pipe-to-ground at
`(1,4)`, at the next four-row seam. The second machine repeats this arrangement at an offset of
`(0,4)`; the finite export includes belt and pipe endpoints after it.

The short pipe run at `(2,3)` and `(1,3)` is an **adaptor**: it presents the lower machine fluid
connection at a usable west-side routing position. From there the fluid can use underground pipe
routing, as in the other patterns, or the adaptor can extend farther west to meet a regular trunk.
Model the adaptor as part of the wrapper around the machine, not as a new fluid port on the machine
itself. Reserve its cells before placing the output inserter, belt, and other fluid branch. The
extra row below the machine is why this example repeats every four rows rather than three.

For generation, map each recipe fluid to the correct physical connection after rotation and
mirroring, then route from those connections to useful outer ports. Check underground partners and
the two fluids' network separation across adjacent copies. The outer wrapper can be irregular:
`chem-2f2s-in-1f1s-out` is another non-human wrapping, with separate fluid trunks and seam endpoints
chosen for transport geometry rather than visual symmetry.

The generator's `adapted-fluid-input` strategy uses a reflected 6x4 wrapper so the casting machine
can remain unmirrored and north-facing. The machine occupies `(1..3,0..2)`, the output belt runs
south at `x=5`, and the output inserter occupies `(4,1)`. The west input has an ordinary pipe at
`(0,2)` between underground endpoints `(0,1)` facing south and `(0,3)` facing north. The south input
turns through `(3,3)` and `(4,3)`, with underground endpoints `(4,2)` facing south and `(4,0)`
facing north. The row-zero endpoint belongs to the previous copy's adaptor; both trunks pair
underground across copies at a distance of two tiles.

Port selection uses rotated physical coordinates and the recipe-fluid assignment described in
`docs/FLUIDBOXES.md`, including explicit ingredient indexes when supplied. This matters for the
casting machine: its three input boxes serve two fluids, so merely selecting different prototype
boxes does not prove that both fluids are connected. The strategy supports two fluid inputs and one
solid output, limited to one belt lane and the single free output inserter site.

### The fixed `2s-in-1s-out-snake` kernel

`ass-2s-in-1s-out-snake.json` is a useful validation fixture rather than a family from which to
derive smaller variants. It fits two 3x3 assembling machines, two solid input belts, one solid
output belt, and one medium electric pole into a regular 7x6 tile. Translating it by `(0,6)` repeats
the layout vertically.

Normalize the blueprint's top-left corner to `(0,0)`. The upper machine occupies `(2,0)` through
`(4,2)` and the lower machine occupies `(2,3)` through `(4,5)`. They touch along the boundary
between rows 2 and 3. The two outer columns, `x=0` and `x=6`, carry all three logical belts by
alternating surface and underground sections.

#### The two input belts

Input A is a straight northbound underground belt in column `x=0`:

- its input endpoint is `(0,5)` and its output endpoint is `(0,0)`, a six-cell inclusive span;
- the lower assembler reads the input endpoint through the inserter at `(1,5)`; and
- the upper assembler reads the output endpoint through the inserter at `(1,0)`.

The output snake occupies surface belts in the same column between those endpoints, but it does not
connect to Input A because Input A passes beneath them.

Input B is the corresponding northbound underground line in column `x=6`, phased across the tile
boundary. Within one tile its exposed endpoints are `(6,3)`, an output read by the lower assembler,
and `(6,2)`, an input read by the upper assembler. The output feeds directly into the adjacent
input. That input then pairs with `(6,3)` in the copy above, not with `(6,3)` in its own tile. A
single fixture therefore contains two apparently unpaired endpoints; the pair exists only in the
periodic layout.

Both assemblers can read both lanes of both input belts. The fixed kernel consequently supports up
to four dependable solid ingredient lanes, subject to belt and inserter throughput.

#### The output snake

The output belt enters the tile northbound at `(6,5)`, crosses to the west below the lower
assembler, runs north along `x=0`, then crosses back to the east above the upper assembler:

```text
(6,5) north -> (6,4) west
             -> underground from (5,4) to (1,4)
             -> (0,4) north -> (0,3) north -> (0,2) north -> (0,1) east
             -> underground from (1,1) to (5,1)
             -> (6,1) north -> (6,0) north -> next tile
```

Both horizontal underground pairs have an inclusive span of five cells. The vertical Input A pair
has a span of six. All fit within the fixture's fast underground belt reach.

The lower assembler's east-facing inserter at `(1,3)` drops onto `(0,3)`. Because the inserter is
east of that northbound belt, it populates the belt's left lane. The upper assembler's west-facing
inserter at `(5,0)` drops onto `(6,0)` from the opposite side and populates the right lane. Thus two
copies of the same recipe automatically contribute equally to opposite lanes of one logical output
belt. Unlike the one-assembler kernels, the snake can use the full belt throughput without a second
output pattern or lane balancer, provided the two assemblers have equal production rates and their
inserters can sustain those rates.

The fixture deliberately uses fast transport belts, fast underground belts, assembling machine 3s,
ordinary inserters, and a medium electric pole. Since this is a fixed validation case, validation
should preserve those prototypes and all 25 entities rather than treating the layout as a generic
source for belt-count or machine-tier variants.

Validation must build at least three translated copies before checking underground pairing and belt
connectivity. Checking the isolated 25-entity document would incorrectly report Input B's endpoints
as unpaired. In the periodic graph, verify that:

- each assembler has transfers from both independent input belts;
- the output snake is one continuous belt through both horizontal underground pairs and both tile
  seams;
- the lower and upper output inserters target opposite lanes of that same belt;
- Input A does not connect to the surface output segments sharing column `x=0`;
- Input B pairs only with the intended endpoint in the neighboring tile; and
- translated entity footprints remain collision-free.

## Validation requirements

A generated kernel should be checked before encoding:

- construct the periodic neighborhood `U-t`, `U`, and `U+t`, where `t` is the repeat vector;
- no entity footprints overlap within that neighborhood;
- every inserter pickup and drop resolves using that inserter prototype's actual reach;
- every required solid ingredient has a belt-to-machine transfer;
- the sole solid product has a machine-to-belt transfer;
- assigned lane rates and local inserter rates stay within their capacities;
- output inserters populate the lanes assumed by the rate calculation;
- every through-belt and through-pipe connects across both periodic seams;
- each intended belt and fluid network remains independent from the others;
- every underground endpoint has exactly its intended compatible, in-range partner, including pairs
  which cross a seam;
- required, rotated fluid connection points remain reachable by pipes; and
- encoding and decoding preserves the complete blueprint document.

There is a subtle limitation in the current belt analyzer: `findInserterTransfers` uses explicit
`pickup_position` and `drop_position` when present, but otherwise defaults every inserter to a
one-tile reach. Factorio does not serialize the ordinary two-tile offsets on the long-handed
inserters in these fixtures. Analyzing them without prototype reach data therefore associates, for
example, the far-west long inserter with the near-west belt and the output long inserter with the
near-east belt. Generation and validation must resolve reach from the inserter prototype (or emit
explicit endpoint offsets in an internal entity model) before trusting those transfer associations.
