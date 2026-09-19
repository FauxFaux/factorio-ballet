# Tileable assembler blueprints

This note describes the solid-item transport pattern demonstrated by `ass-3s-in-1s-out.base64` and
its one-fluid extension in `ass-3s-1f-in-1s-out.base64`. The matching JSON files are easier to
inspect and are the authoritative entity lists; both exchange strings decode to their JSON exactly.

The fixture is a transport kernel rather than a complete powered factory. It contains one 3x3
assembling machine, belts, and inserters, but no recipe, filters, modules, power poles, or circuit
conditions.

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

## Choosing a pattern from item rates

Counts per craft determine rates; rates determine transport. For a proposed run of `n` identical
assemblers, compute the per-second rate of every solid ingredient and product after machine speed,
modules, and productivity have been applied.

For a belt whose `itemsPerSecond` is `B`, treat each lane as a bin of capacity `B / 2`:

1. Multiply every per-assembler solid rate by `n` to obtain the peak rate entering an input belt at
   the supply end, or leaving the output belt after the last assembler.
2. Assign each input item to one lane. Do not split an item across lanes unless the generated
   upstream routing also performs that split.
3. Use the smallest canonical input pattern whose lane assignment fits. Reject the three-input-belt
   kernel if more than six distinct solid inputs are required or if the rates do not fit its six
   lanes.
4. Require the one solid output to fit `B / 2`, because all copies insert onto the same output lane.
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

## Validation requirements

A generated kernel should be checked before encoding:

- no entity footprints overlap;
- every inserter pickup and drop resolves using that inserter prototype's actual reach;
- every required solid ingredient has a belt-to-machine transfer;
- the sole solid product has a machine-to-belt transfer;
- assigned lane rates and local inserter rates stay within their capacities;
- every through-belt connects across both `+pitch` and `-pitch` copies;
- every through-pipe connects across both `+pitch` and `-pitch` copies;
- underground pipe and belt endpoints form valid, in-range pairs;
- the two translated copies have no collisions;
- required, rotated fluid connection points remain reachable by pipes; and
- encoding and decoding preserves the complete blueprint document.

There is a subtle limitation in the current belt analyzer: `findInserterTransfers` uses explicit
`pickup_position` and `drop_position` when present, but otherwise defaults every inserter to a
one-tile reach. Factorio does not serialize the ordinary two-tile offsets on the long-handed
inserters in this fixture. Analyzing the fixture without prototype reach data therefore associates
the far-west long inserter with the near-west belt and the output long inserter with the near-east
belt. Generation and validation must resolve reach from the inserter prototype (or emit explicit
endpoint offsets in an internal entity model) before trusting those transfer associations.
