# High-throughput assembler blueprints

This note records more complex solid-item transport patterns with more belt access and inserter
sites per assembler. It extends [Tileable assembler blueprints](ASSEMBLERS.md), using the same
integer-cell coordinates, direction values, and one-item-per-lane convention. The JSON fixtures are
the authoritative entity lists; their matching `.base64` files are importable blueprints. Some
designs require several assemblers in a repeat unit. Distinguish that requirement from a fixture
showing several copies of a one-assembler tile to demonstrate the seam connections.

## Seven belts at a seven-tile pitch: `ass-13l-pitch-7`

[`ass-13l-pitch-7.json`](ass-13l-pitch-7.json) shows two assembling-machine-2s stacked vertically,
each with access to the same seven independent northbound belts. Four belts run along the sides; the
middle three pass underground beneath the machines. The reusable tile is 9x7 cells, contains one
assembler, and repeats by `(0,7)`. The fixture shows two tiles, occupying a 9x14 rectangle.

Seven belts provide fourteen lanes. Reserving only one lane for the sole solid product leaves
**thirteen input lanes**, including the other lane of the belt carrying the output. The `13l`
filename therefore counts available input lanes, rather than thirteen belts or thirteen inserters.

### Geometry and inserter sites

Normalize the top-left corner of the fixture to `(0,0)`: blueprint position `(457.5,-711.5)` is the
centre of cell `(0,0)`. The first assembler occupies `(3,2)` through `(5,4)`, with local centre
`(4.5,3.5)`. The second occupies `(3,9)` through `(5,11)`.

In the diagram, `B` is a northbound surface belt, `Uo` a northbound underground output, `Ui` a
northbound underground input, `i` a short-reach input inserter, `L` a two-tile-reach input inserter,
and `O` a two-tile-reach output inserter. Arrows show item transfer into or out of the assembler,
rather than the serialized inserter direction.

```text
        x=0  1   2    3   4   5    6   7  8
y=0       B  B   .   Uo  Uo  Uo    .   B  B
y=1       B  B   .   iv  iv  iv    .   B  B
y=2       B  B  L->  [A   A   A]  <-L  B  B
y=3       B  B  <-O  [A   A   A]  <-L  B  B
y=4       B  B  i->  [A   A   A]  <-i  B  B
y=5       B  B   .   i^  i^  i^    .   B  B
y=6       B  B   .   Ui  Ui  Ui    .   B  B
```

The exported fixture populates all twelve edge positions per assembler: three on each of its four
sides. Eight use `bob-express-bulk-inserter` and four use `bob-red-inserter`. Eleven feed the
assembler; the remaining red inserter takes the product out. There are twenty-four inserters in the
two-tile fixture.

| Belt          | Column | Inserter bases in one tile    | Transfer                           |
| ------------- | ------ | ----------------------------- | ---------------------------------- |
| far west      | `x=0`  | `(2,2)` input; `(2,3)` output | one input lane and one output lane |
| near west     | `x=1`  | `(2,4)` input                 | two input lanes                    |
| middle west   | `x=3`  | `(3,1)` and `(3,5)` input     | two input lanes, two inserters     |
| middle centre | `x=4`  | `(4,1)` and `(4,5)` input     | two input lanes, two inserters     |
| middle east   | `x=5`  | `(5,1)` and `(5,5)` input     | two input lanes, two inserters     |
| near east     | `x=7`  | `(6,4)` input                 | two input lanes                    |
| far east      | `x=8`  | `(6,2)` and `(6,3)` input     | two input lanes, two inserters     |

The red inserters have explicit `pickup_position` and `drop_position` offsets in the JSON. Their
pickups reach two tiles from the base, and their drops include a fractional offset. Preserve these
offsets when inspecting or reproducing the fixture; deriving every transfer from a one-tile default
would associate them with the wrong belt. The west output inserter has direction `4`; the west input
inserters have direction `12`, and the east input inserters have direction `4`. The top input
inserters omit direction, meaning north (`0`); the bottom inputs face south (`8`).

### The middle three belts and the tile seam

Each middle belt has two inserters per assembler, using both exposed ends of its underground
section. The north-side inserter at `(x,1)` reads the output endpoint at `(x,0)`; the south-side
inserter at `(x,5)` reads the input endpoint at `(x,6)`, for `x=3,4,5`. These are two pickup sites
on one continuous belt, so they share that belt's lane capacity.

The belt travels north from the input at row 6 to the output at row 0. Their centres are six tiles
apart, with five intervening cells: the three assembler rows and the two inserter rows. The pitch
therefore makes room for belt endpoint, inserter, three machine rows, inserter, belt endpoint.

In the second tile, the corresponding input is at row 13 and output at row 7. That output feeds
directly into the first tile's input at row 6. The endpoint pairs remain within their own tiles; the
surface connection between output and input crosses the tile seam. The outer four belts have a
surface segment in every row and connect directly across the same seam.

Both assemblers can consequently draw from all seven belts. They share the same through-lines;
adding another tile adds another consumer and producer, without adding transport capacity.

### Lane allocation and throughput

The far-west belt shares input and output roles. For the thirteen-input-lane arrangement, dedicate
the output inserter's target lane to the product and supply an ingredient on its other lane. Filter
the far-west input inserter to the ingredient so it cannot pick up products from the output lane.
The fixture contains no filters or recipes, so it demonstrates the access geometry before this
assignment is configured.

If a full belt has capacity `B`, each lane has capacity `B / 2`. For `n` repeated assemblers:

- each input lane must carry the total demand of all `n` assemblers within `B / 2`;
- the one output lane must carry their combined production within `B / 2`;
- each inserter, or pair of inserters serving one belt, must sustain its assigned local transfer
  rate; and
- two inserters serving one belt can be filtered to separate its two ingredients or share the work
  for a high-rate ingredient, while still respecting each lane's capacity.

Six of the short-reach inserters serve the middle belts, giving two pickup sites on each. The near
side belts each have one short-reach inserter; the far-east belt has two red inserters; and the
far-west belt has one red input and one red output. This offers more local transfer sites than the
compact three-row patterns, at the cost of a seven-row pitch and additional underground entities.
The geometry establishes lane access; achievable rates depend on the selected inserter prototypes,
their settings, and the recipe's demand. Reserving more output lanes reduces the input-lane count
and requires a corresponding output transfer arrangement.

### Checks when reproducing the pattern

Check a tile together with copies translated by `(0,-7)` and `(0,7)`. Confirm that the seven belt
lines remain independent and continuous, that each middle underground pair is within the selected
prototype's reach, and that no translated footprints overlap. Resolve the red inserters using their
explicit offsets, verify the shared far-west belt's filter and output lane, and check cumulative
lane rates separately from local inserter rates. The fixture includes no power poles, modules, or
fluid plumbing; adding a fluid connection requires revisiting the occupied edge sites.
