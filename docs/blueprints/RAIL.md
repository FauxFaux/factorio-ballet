# Rail blueprint notes

These notes describe the Factorio 2.x rail geometry demonstrated by the fixtures in
`docs/bluprints/`. The fixtures are the authority when they disagree with the older
`docs/blueprint.wiki`.

## Blueprint representation

A rail is an entity with an `entity_number`, prototype `name`, anchor `position`, and usually a
`direction`. A missing direction means `0` (north). The rail fixtures use the even values from the
16-way direction list:

| Value | Name      |
| ----: | --------- |
|     0 | north     |
|     2 | northeast |
|     4 | east      |
|     6 | southeast |
|     8 | south     |
|    10 | southwest |
|    12 | west      |
|    14 | northwest |

The direction selects a rail piece's geometry. It does **not** say which way a train travels; bare
rail is bidirectional. Signals placed on one side of the rail impose the one-way, left-hand-running
scheme. Factorio's runtime model likewise treats a rail as having `front` and `back` ends, with
`left`, `straight`, and `right` connection choices at an end. See the official
[`LuaEntity.get_connected_rail`](https://lua-api.factorio.com/latest/classes/LuaEntity.html#get_connected_rail)
and
[`rail_connection_direction`](https://lua-api.factorio.com/latest/defines.html#rail_connection_direction)
documentation.

The ground-level fixtures contain four rail prototypes:

- `straight-rail`
- `half-diagonal-rail`
- `curved-rail-a`
- `curved-rail-b`

The two curve prototypes are consecutive parts of a 90-degree curve, not interchangeable variants of
one entity. A complete turn normally reads `A, B, B, A` between cardinal straight tracks.

## Connection model

`src/bp/rail.ts` converts the entities to `RailPiece`s with two `RailEnd`s and groups touching ends
into a `RailGraph`. Connection keys use doubled coordinates (`x2`, `y2`) so half tiles remain exact.
Node degree has a useful interpretation:

- 1: an unconnected blueprint boundary or unfinished rail end
- 2: an ordinary continuation
- 3 or more: a switch or overlapping junction

The keys are topological, not entity bounding-box centres. This distinction matters for
`half-diagonal-rail`: its blueprint anchor is asymmetric, and one logical end can accept curve
sub-types whose anchors differ by one tile. `RailEnd.connectionPoints` therefore permits equivalent
keys for one end.

The geometry table currently covers every `(name, direction)` pair present in these fixtures:
cardinal straight rail (`0`, `4`), half-diagonal rail (`4`, `6`), and all eight orientations of both
curve prototypes. Other straight and half-diagonal directions deliberately throw an unsupported
geometry error. We need a small in-game example of each absent orientation before extending the
table.

## Small examples

### Tightest circle

`rail-circle.json` has 16 pieces: eight `curved-rail-a` and eight `curved-rail-b`. The graph has 16
nodes, and every node has degree 2, so the loop closes with no inferred gaps. Walking clockwise from
the top-left piece gives:

```text
A12 B12 B2 A2 A8 B8 B14 A14 A4 B4 B10 A10 A0 B0 B6 A6
```

The pairs of adjacent A pieces at the top, bottom, left, and right are where one 90-degree curve
ends and the next begins.

### The r-shaped chain

The corrected `rail-r.json` is an open, continuous chain of 12 pieces. From its vertical tail to its
horizontal tip it is:

```text
straight 0 ×4 -> A2 -> B2 -> B12 -> half-diagonal 4 ×2 -> A12 -> straight 4 ×2
```

It produces 13 graph nodes: 11 degree-2 joins and the expected two open ends. In particular, this
fixture establishes how repeated half-diagonal pieces bridge a B curve to an A curve.

## The base brick

Use `empty-grid-v0.json` as the brick's coordinate system. Rail entity anchors span `x = -1..225`,
`y = -1..161`. The repeated rectangle's paired lanes are centred around:

| Edge   | Outer track | Inner track | Inner-track travel |
| ------ | ----------: | ----------: | ------------------ |
| top    |    `y = 13` |    `y = 19` | west               |
| right  |   `x = 211` |   `x = 205` | north              |
| bottom |   `y = 147` |   `y = 141` | east               |
| left   |    `x = 13` |    `x = 19` | south              |

That is counter-clockwise travel on the inner track, consistent with trains driving on the left. The
rails themselves do not encode these arrows; this interpretation combines the geometry with the
signal placement and the stated left-hand-running convention.

There are six T-junction complexes: one pointing inward at each corner, plus outward-facing
junctions halfway along the top and bottom. At the graph level the brick contains:

| Measurement             | Count |
| ----------------------- | ----: |
| rail pieces             |   784 |
| ordinary degree-2 nodes |   724 |
| degree-3 switch nodes   |    36 |
| open boundary nodes     |    12 |

The 12 boundary connections are two at the top (`x = 109,115`), two at the bottom, and four on each
short side (`y = 13,19,141,147`). Their outward graph coordinates lie one tile beyond the outermost
rail anchors.

## Aligning the plus-four variants

Both plus-four blueprints use the same local coordinates. Add this translation to either one to put
it in `empty-grid-v0` coordinates:

```text
x' = x + 1248
y' = y + 736
```

This is not just a bounds match: 686 rail entities have exactly the same normalized name, position,
and direction as the base brick. `findRailAlignment()` discovers that translation by maximizing
exact rail overlap.

The variants are not strict supersets of the base blueprint. Each contains 832 rails, shares 686,
adds 146 at its modified side, and omits/replaces 98 base rails. Much of the replaced set is around
the base brick's right edge (`x = 211` and the ends of its horizontal tracks). Code that combines
these should therefore apply a variant as a replacement region, not blindly append its entities to
the base.

### Added vertical tracks

After normalization, the four long runs are:

| Variant | Vertical track x coordinates | Straight-run y ranges                      |
| ------- | ---------------------------- | ------------------------------------------ |
| left    | `27, 39, 51, 63`             | `51..109`, `59..101`, `61..101`, `61..101` |
| right   | `161, 173, 185, 197`         | `59..99`, `59..99`, `59..101`, `51..109`   |

Successive straight anchors are two tiles apart. Adjacent parallel tracks are 12 tiles apart. All
four added tracks sit inside the rectangle: to the right of the left inner lane (`x = 19`) or to the
left of the right inner lane (`x = 205`).

### How the verticals curve into the horizontals

A representative simple top-left turn, from the `x = 51` vertical onto `y = 47`, is:

```text
straight x=51
  -> A0  (51,58)
  -> B0  (49,53)
  -> B6  (45,49)
  -> A6  (40,47)
  -> straight y=47
```

The bottom-left mirror from the same vertical onto `y = 115` is:

```text
straight x=51
  -> A10 (51,104)
  -> B10 (49,109)
  -> B4  (45,113)
  -> A4  (40,115)
  -> straight y=115
```

On the right, the `x = 161` top and bottom turns are the horizontal mirrors:

```text
top:    A2 (161,56) -> B2 (163,51) -> B12 (167,47) -> A12 (172,45)
bottom: A8 (161,102) -> B8 (163,107) -> B14 (167,111) -> A14 (172,113)
```

The longer outer added tracks (`x = 27` on the left and `x = 197` on the right) feed into the
existing inner vertical lane through overlapping B curves. The funnel between added lanes uses the
only half-diagonal pieces in either blueprint:

| Variant | Top half-diagonal       | Bottom half-diagonal     |
| ------- | ----------------------- | ------------------------ |
| left    | `(29,45)`, direction 6  | `(29,115)`, direction 4  |
| right   | `(195,45)`, direction 4 | `(195,115)`, direction 6 |

These are mirror placements. Around them, several curve entities share a logical end; that is the
switch fan which allows a train to select a parallel vertical rather than four isolated bends.

## The four-path overlay

Every one of the 215 entities in `4x-train-layout.json` overlays an entity in the left plus-four
brick after this translation:

```text
x' = x - 1152
y' = y
```

The four added paths are the independent vertical branches at `x = -69, -57, -45, -33` in the
layout's coordinates. The run at `x = -77` is not a fifth path: it is the brick's existing inner
lane and part of the common approach. Each added path consists of a vertical straight run with an
`A, B, B, A` turn at both ends. The horizontal rails between branch points form a shared throat.

The same 215 entities overlay the right plus-four brick after a half-turn:

```text
x' = -x - 1120
y' = -y - 1312
```

For that rotation, curve and signal directions advance by 8 modulo 16. Straight and half-diagonal
rail serialize to the same canonical direction after a 180-degree rotation.

`3x-train-layout.json` and its importable `.base64` counterpart are derived by removing the complete
rightmost `x = -33` branch. The removal comprises 41 rails: four upper curves, 21 vertical
straights, four lower curves, and the twelve horizontal pieces between this branch and the preceding
switch. It also removes the branch's two rail signals, electric pole, and the copper wire ending at
that pole. The remaining entity numbers and wire endpoints are renumbered consecutively. The shared
throat up to the last remaining switch and the three paths at `x = -69, -57, -45` remain intact. The
derived graph retains the original layout's four external ends, confirming that no dead-end stubs
were left by the cut.

## Repeatable workflow

Use `scripts/rail-blueprint.ts` as the executable recipe for this analysis. It contains the reusable
parts of the one-off research: topology inspection, direct or half-turn overlay matching, entity
renumbering, reference repair, zlib/base64 encoding, and removal of the rightmost path in this
12-tile-pitch fan design.

Decode a fresh game export with the earlier general blueprint script:

```sh
node scripts/blueprint.ts docs/bluprints/example.base64 > docs/bluprints/example.json
```

Inspect a decoded blueprint before changing it:

```sh
node scripts/rail-blueprint.ts inspect docs/bluprints/4x-train-layout.json
```

Verify the two overlays. `SOURCE` is transformed into `TARGET` coordinates:

```sh
node scripts/rail-blueprint.ts overlay \
  docs/bluprints/4x-train-layout.json \
  docs/bluprints/empty-plus-left-four.json

node scripts/rail-blueprint.ts overlay \
  docs/bluprints/4x-train-layout.json \
  docs/bluprints/empty-plus-right-four.json \
  --rotate-180
```

For an exact overlay, `matchingEntities` equals `sourceEntities`. The reported offset is added after
the optional rotation.

Remove the rightmost path and write synchronized decoded and game-importable outputs:

```sh
node scripts/rail-blueprint.ts remove-rightmost \
  docs/bluprints/4x-train-layout.json \
  docs/bluprints/3x-train-layout.json \
  docs/bluprints/3x-train-layout.base64
npx oxfmt docs/bluprints/3x-train-layout.json
```

The removal command is intentionally specialized to the demonstrated fan: vertical paths at a
12-tile pitch, `A, B, B, A` turns, and horizontal throats between switches. It locates the rightmost
vertical automatically, requires exactly eight surrounding curves, removes its exclusive throat,
signals and pole, then renumbers entity references in circuit connections, neighbours, schedules,
and top-level wires. It aborts if the operation changes the number of open rail ends; that catches
the dead-end throat stubs produced by removing only the vertical and its curves.

After generating a new fixture, run:

```sh
npx vitest run test/scripts/rail-blueprint.test.ts test/bp/rail.test.ts test/bp/decode.test.ts
npm run lint
npm test
```

## Limits and next useful samples

The current graph is intentionally about rail geometry only. It does not yet associate signals with
a side of a rail, divide the network into signal blocks, or calculate legal directed train paths. It
also does not cover elevated rails.

If those features become necessary, the most useful new game exports would be isolated examples of:

1. straight rail in diagonal orientations;
2. half-diagonal rail in directions other than 4 and 6;
3. one rail signal and one chain signal on each side of a single straight;
4. the same signalled examples rotated through the cardinal directions.
