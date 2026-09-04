# Radar view algorithm

This document describes the approximate factory-layout SVG shown on the process-management screen in
`../factorio-loader`. All paths are relative to that directory.

It is intended as a behavioral guide for implementing the same kind of view over a different data
model. The useful boundary is: first adapt the application's data into districts and external flows,
then perform the heuristic layout, then render the resulting geometry. The current implementation is
a visual estimate, not a blueprint generator, a flow simulation, or an optimized graph layout.

## Source map

- The process-management page derives imports, exports, solved recipe counts, rates, machine
  dimensions, and district ports in
  [`web/pages/proc-mgmt.tsx`, lines 60–115](web/pages/proc-mgmt.tsx#L60-L115) and
  [`web/pages/proc-mgmt.tsx`, lines 423–456](web/pages/proc-mgmt.tsx#L423-L456).
- The solver adapter that supplies recipe counts is in
  [`web/stubs/process-mgmt.ts`, lines 51–83](web/stubs/process-mgmt.ts#L51-L83).
- Rate signs and scaling are defined in
  [`web/pages/plan.tsx`, lines 65–89](web/pages/plan.tsx#L65-L89): ingredients are negative,
  products positive, and totals scale with machine count, crafting speed, and recipe time.
- Machine footprint selection is in
  [`web/pages/plan.tsx`, lines 648–655](web/pages/plan.tsx#L648-L655), backed by the factory
  metadata shape in [`web/datae.ts`, lines 18–29](web/datae.ts#L18-L29).
- The layout input contract and all radar layout/rendering logic are in
  [`web/components/layout.tsx`, lines 6–23](web/components/layout.tsx#L6-L23),
  [`web/components/layout.tsx`, lines 32–236](web/components/layout.tsx#L32-L236), and
  [`web/components/layout.tsx`, lines 240–553](web/components/layout.tsx#L240-L553).

## Normalize the new data model first

The layout knows only three concepts:

1. A **district** represents one recipe/process. It has a desired machine count, one machine
   footprint, and maps of input and output material identifiers to lane counts.
2. **External input flow** maps imported material identifiers to signed rates.
3. **External output flow** maps exported material identifiers to signed rates.

The exact TypeScript shape is recorded at
[`web/components/layout.tsx`, lines 11–23](web/components/layout.tsx#L11-L23). A port key, rather
than object identity, connects producers to consumers. An implementation against different data
should therefore introduce stable material IDs and build this small intermediate model instead of
coupling the layout to the new domain objects.

On the source screen, imports are materials consumed but not produced internally, with explicit user
overrides subsequently applied. Exports are materials produced but not consumed internally, again
modified by requirements and overrides. See
[`web/pages/proc-mgmt.tsx`, lines 60–88](web/pages/proc-mgmt.tsx#L60-L88) and the post-solver export
adjustment at [`web/pages/proc-mgmt.tsx`, lines 102–107](web/pages/proc-mgmt.tsx#L102-L107).

Each district's machine count comes from the external process solver. Its footprint is the first
known factory footprint for the recipe's producer class, rotated if necessary so that width is no
greater than height. This selection is visible at
[`web/pages/proc-mgmt.tsx`, lines 441–447](web/pages/proc-mgmt.tsx#L441-L447) and
[`web/pages/plan.tsx`, lines 648–655](web/pages/plan.tsx#L648-L655). The radar does not choose among
factory variants.

## Belt/lane counts

The adapter converts each material's per-second district flow into a lane count before layout:

- Every fluid port is assigned exactly **2 lanes**, regardless of rate.
- Every item port is assigned **ceil(abs(rate) / 15)** lanes, treating 15 items/s as one lane.
- Negative effects become input ports and positive effects become output ports.

These rules are at [`web/pages/proc-mgmt.tsx`, lines 427–447](web/pages/proc-mgmt.tsx#L427-L447).
Zero effects are omitted. The rate used here is the district's total solved effect, not the
per-machine recipe quantity.

For a district, all input lane counts are summed and all output lane counts are summed. Each total
is divided between the sides of an assembler stack. If a side has any lanes, one extra tile of
spacing is added. This produces the input-side and output-side spacing values used by the packing
routines; see [`web/components/layout.tsx`, lines 146–163](web/components/layout.tsx#L146-L163).

The number of drawn vertical belt lines is effectively half the relevant total lane count, rounded
upward:

- A single assembler column draws `ceil(input lanes / 2)` lines on its input side and
  `ceil(output lanes / 2)` on its output side.
- A paired-column block repeats the input lines outside both columns and draws the output lines in
  the middle, so it draws twice the single-side input count plus the single output count.
- Those lines are repeated for each full paired-column block. A final partial block still reserves a
  full paired block and emits its belt geometry.

The precise loops and positions are in
[`web/components/layout.tsx`, lines 475–519](web/components/layout.tsx#L475-L519) for paired columns
and [`web/components/layout.tsx`, lines 526–553](web/components/layout.tsx#L526-L553) for one
column. When a paired block is filled exactly, the cursor advances and the final cleanup emits one
additional set of zero-height belt paths for the empty reserved block. Odd lane totals create
half-tile spacing internally; the loops round the number of lines upward. There is a comment
acknowledging that lane counts above two are not fully handled at
[`web/components/layout.tsx`, lines 156–160](web/components/layout.tsx#L156-L160). Treat the result
as a density cue, not literal belt routing: belts are not assigned material identities, joined to
individual assemblers, or connected to the horizontal bus.

## Assembler columns and district width

Districts are laid out left-to-right. Within one district, assemblers stack vertically with no
vertical gap. The available stack height is a fixed **100 coordinate units**; see
[`web/components/layout.tsx`, lines 142–157](web/components/layout.tsx#L142-L157).

There are two packing modes:

- **One column:** chosen when `machine count × machine height` is at most two-thirds of 100. Every
  machine is placed in a single vertical stack. The district bounds are the input spacing, machine
  width, and output spacing horizontally, and the accumulated machine heights vertically. The
  threshold and delegation are at
  [`web/components/layout.tsx`, lines 452–459](web/components/layout.tsx#L452-L459); placement and
  bounds are at [`web/components/layout.tsx`, lines 526–553](web/components/layout.tsx#L526-L553).
- **Paired columns:** used above that threshold. Machines alternate between a left and right column
  at the same row. After placing the right-hand machine, the row advances by one machine height.
  Once the accumulated height reaches 100, a new paired block begins to the right. The reserved
  block width is two machine widths, one input-spacing allowance, and two output-spacing allowances;
  adjacent paired blocks have a further 2-unit gap. Placement is asymmetric: the first machine is
  offset by the input spacing, the machines are separated by output spacing, and the final reserved
  spacing is also based on outputs even though right-side input belts are drawn there. See
  [`web/components/layout.tsx`, lines 459–498](web/components/layout.tsx#L459-L498).

For an integral machine count, let `R = ceil(100 / machine height)` be the rows in a full paired
block. Because the cursor advances as soon as a block fills and final bounds are then added
unconditionally, the number of reserved paired blocks is `floor(machine count / (2R)) + 1`, and the
reserved column count is twice that. This reserves two blocks when the machines exactly fill one,
including an empty trailing block. A partially filled final block also reserves both of its columns
even if it contains only a left-hand machine. A one-column district always reserves one column.

Solver counts can be fractional, but placement loops compare an integer loop index with that
fraction. Consequently, a positive fractional count draws the next whole machine: the visible count
is effectively the ceiling. The one-versus-two-column threshold, however, uses the unrounded count.
This subtle mismatch follows from
[`web/components/layout.tsx`, lines 455–457](web/components/layout.tsx#L455-L457),
[`web/components/layout.tsx`, lines 467–475](web/components/layout.tsx#L467-L475), and
[`web/components/layout.tsx`, lines 533–537](web/components/layout.tsx#L533-L537). A new
implementation should decide explicitly whether it wants this behavior.

After a district is packed, its local assembler and belt coordinates are translated to the current
global cursor. The cursor advances by the district's reserved width plus a fixed **4-unit
inter-district gap**. See
[`web/components/layout.tsx`, lines 202–221](web/components/layout.tsx#L202-L221).

## Process order and cycles

The graph has one node per district plus sentinel import and export nodes. It contains:

- an import-to-district edge when an external import is present in that district's inputs;
- a district-to-district edge when any output material of the first is an input material of the
  second;
- a district-to-export edge when a district output is externally exported.

Edge construction is at
[`web/components/layout.tsx`, lines 32–73](web/components/layout.tsx#L32-L73). Edges express
material compatibility only; they do not allocate a producer's rate among consumers.

Before traversing, districts are sorted by descending solved machine count, with descending recipe
ID as the tie-breaker. That makes traversal mostly deterministic for identical data, but it mutates
the district array. See
[`web/components/layout.tsx`, lines 83–89](web/components/layout.tsx#L83-L89).

The displayed sequence is **not a topological sort**. It is depth-first pre-order starting at the
import sentinel: append a node the first time it is seen, then visit its outgoing neighbors. A
visited check prevents infinite recursion when a cycle points back to a node already on or completed
by the traversal. Cyclic processes therefore remain in a stable DFS order, but their dependencies
can point backward. See
[`web/components/layout.tsx`, lines 90–100](web/components/layout.tsx#L90-L100).

Nodes unreachable from imports are inserted afterward, immediately before their earliest consumer
already in the order; a node with no placed consumer falls at the end. This heuristic is at
[`web/components/layout.tsx`, lines 101–113](web/components/layout.tsx#L101-L113). For disconnected
cycles, the outcome depends on the sorted/index order in which these insertions occur and is still
not guaranteed to satisfy every edge.

The implementation computes a diagnostic edge-length score after ordering. Forward-edge cost is
distance times edge lane weight; backward edges cost twice their absolute weighted distance. The
score is only logged and never used to improve the order. See
[`web/components/layout.tsx`, lines 115–126](web/components/layout.tsx#L115-L126). A port shared by
two districts contributes the producer's output-lane count to that edge; this weight is not a solved
inter-district flow.

For a new implementation, preserve DFS-with-visited behavior only if visual similarity is important.
If the requirement is genuinely topological ordering, collapse strongly connected components first,
topologically sort the resulting acyclic graph, and choose a deterministic internal order for each
cyclic component.

## Station counts and placement

Input and output stations are allocated independently from their respective external-flow maps. The
allocator sorts materials by descending absolute rate, then greedily puts each material into the
first existing station that currently has fewer than four material types and a current summed rate
no greater than 30. If none qualifies, it opens a new station. See
[`web/components/layout.tsx`, lines 240–262](web/components/layout.tsx#L240-L262).

Two details matter when reproducing the count:

- The **four-material limit** is enforced before insertion.
- The **30/s limit is tested before, not after, adding the next material**. A station at 30/s may
  accept another material and a station below 30/s may overshoot 30/s. It then accepts no more
  materials because its existing sum is above 30. A single material above 30 simply occupies a newly
  created station.

Thus station count is the result of this greedy first-fit procedure, not `ceil(total rate / 30)`. An
older total-rate formula is present only as a comment at
[`web/components/layout.tsx`, lines 243–246](web/components/layout.tsx#L243-L246).

Each station retains only its material labels for rendering. Every input station adds 8 units to the
factory content's starting x-coordinate; see
[`web/components/layout.tsx`, lines 128–138](web/components/layout.tsx#L128-L138). Input station
rails peel rightward from the left border, while output station rails peel leftward from the right
border. Each successive loop is offset by another 8 units and gets one stop dot with a tooltip
listing its materials. The input geometry is at
[`web/components/layout.tsx`, lines 306–330](web/components/layout.tsx#L306-L330); output geometry
is at [`web/components/layout.tsx`, lines 373–395](web/components/layout.tsx#L373-L395). Output
station count does not shift or constrain the district layout.

## Bus width

The bus width is a fixed **4 parallel lines**, not calculated from ports, rates, belts, stations, or
graph edges. It affects both the vertical starting position of the districts and the number of
horizontal lines. The constant and origin calculation are at
[`web/components/layout.tsx`, lines 136–138](web/components/layout.tsx#L136-L138).

Four input-bus lines run from x=8 to the final district cursor above the assemblers. Four output-bus
lines run below them from the first exporting district to fixed x=180. If no district directly
exports a requested material, the output lines start at x=8. See
[`web/components/layout.tsx`, lines 164–169](web/components/layout.tsx#L164-L169) and
[`web/components/layout.tsx`, lines 224–234](web/components/layout.tsx#L224-L234). “First exporting
district” means first in display order with an output key whose external output rate is positive; it
is not the leftmost output belt endpoint derived from routing.

## Recipe icon placement

There is one recipe icon per district, not one per assembler. Its anchor is vertically centered in
the district bounds. Horizontally it is centered over the district width plus the following 4-unit
gap, which shifts it 2 units to the right of the district's strict center. The anchor calculation is
at [`web/components/layout.tsx`, lines 215–221](web/components/layout.tsx#L215-L221).

Rendering places a 32-by-32 HTML icon box centered on that anchor by subtracting 16 from x and y.
The item-icon component receives the recipe ID and a localized recipe name for alternative text; see
[`web/components/layout.tsx`, lines 347–355](web/components/layout.tsx#L347-L355). If a recipe has
no direct icon, the icon component falls back to the first product's icon at
[`web/lists.tsx`, lines 80–88](web/lists.tsx#L80-L88).

Because the icon is much larger than most machine rectangles in SVG coordinate units, it is a
district label overlay rather than a tile-scale object.

## SVG coordinate system and visual semantics

The radar uses a fixed **192 × 128** view box displayed at three times that size. It draws a floor,
rectangular border rails, symbolic belt paths, assembler rectangles, curved station loops, stop
dots, and icons in that order; see
[`web/components/layout.tsx`, lines 397–420](web/components/layout.tsx#L397-L420). The fixed rail
corners and colors are defined at
[`web/components/layout.tsx`, lines 287–304](web/components/layout.tsx#L287-L304).

Assembler layout begins at x equal to 8 plus 8 per input station, and y=16 plus bus width (20 with
the current constant). With a 100-unit maximum district height, a full stack reaches y=120, just
inside the bottom border. Horizontal content has no fitting, scaling, wrapping, or clipping
calculation: enough districts can extend beyond the 192-unit view box. Station rails likewise use
fixed border coordinates. A robust successor may want to calculate the view box from content bounds
while keeping the same relative geometry.

## Recommended porting boundary

For a different data structure, separate the work into these independently testable stages:

1. Convert domain processes, materials, rates, solved machine counts, and footprints into the
   district/external-flow model.
2. Convert rates to approximate lanes.
3. Build the material-connectivity graph and choose a deterministic order, with an explicit policy
   for cycles.
4. Allocate external materials to station groups.
5. Pack every district into one or paired assembler columns and create local belt geometry.
6. Translate districts left-to-right, add the fixed or newly calculated bus, and place one centered
   icon per district.
7. Render rails, stops, belts, machines, and icons from geometry records.

Tests for behavioral compatibility should cover: an odd lane count, a fluid at a tiny rate, a
fractional machine count near the one-column threshold, a final half-filled paired block, a station
that overshoots 30/s, a process cycle reachable from imports, a disconnected cycle, no direct
exporter, and enough districts to exceed the fixed view box.
