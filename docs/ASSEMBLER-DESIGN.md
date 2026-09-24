# Assembler design: coverage and limits

This is a factual map for reviewing how far the stock generator generalises the transport geometry
in [the assembler blueprint notes](blueprints/ASSEMBLERS.md). The blueprint JSON files are geometry
references, not a promise that every fixture is generated. The fixed two-assembler snake, for
example, is expressly a validation fixture; the generator accepts **exactly one assembler**.
Sources: [blueprint scope](blueprints/ASSEMBLERS.md),
[problem preparation](../src/compute/assembler-design.ts).

## Contract and selection

`generateAssemblerDesign(problem, throughput)` takes a `KernelProblem` with boundary rates, one
assembler specification, optional footprint and fluid-box geometry, and three caller-supplied
transport rates: full belt, ordinary inserter, and long inserter. It returns a `FactoryDesign` with
one vertical column or a failure object containing an array of words. It checks that transport rates
are finite and positive, that there is exactly one assembler, and that every supplied resource rate
is finite and positive. Empty flow maps are allowed; individual strategies decide whether a flow is
needed. It does not derive recipe rates or choose transport prototypes. Sources:
[problem types and helpers](../src/compute/kernel-problems.ts),
[entry point and preparation](../src/compute/assembler-design.ts),
[strategy contract](../src/compute/assembler-design/strategy.ts).

All ten strategies run. A strategy returns a candidate, a rejection, or “not applicable.” The
candidate with the smallest sum of occupied column bounding box areas wins; registration order
breaks ties. If none succeeds, the first rejection in registration order is reported. That failure
describes a failed strategy, not necessarily a proof that no other arrangement exists. The area
measure does not count entities, belt usage, stack height, or routing cost. Source:
[strategy registry and selection](../src/compute/assembler-design.ts).

| Strategy                    | Flow class and construction                                                                                                                                                                                                                                                      | Source                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `compact-solid`             | No fluids; one input belt, one solid output belt, or two filtered solid outputs on separate belts. Inserter counts and pitch follow machine height; the two-output version uses one ordinary and one long inserter.                                                              | [solid strategies](../src/compute/assembler-design/solid-strategies.ts)                       |
| `wide-solid`                | No fluids; one solid output, up to six solid inputs on at most three input belts. Places belts on either side, including a far belt read by a long inserter. One high-rate input can be split over the two near belts.                                                           | [solid strategies](../src/compute/assembler-design/solid-strategies.ts)                       |
| `outside-fluid-trunk`       | Exactly three solid inputs and one solid output, with one fluid input and/or one fluid output on a 3×3 machine. Reuses `wide-solid`, then reserves centered ports, moves inserters and crosses belts with underground transport.                                                 | [outside trunk](../src/compute/assembler-design/outside-fluid-strategy.ts)                    |
| `single-fluid-input-trunk`  | One input fluid; up to two solid inputs and one solid output. Rotates a fluid port toward a left pipe trunk and puts optional solid transport on the right.                                                                                                                      | [fluid strategies](../src/compute/assembler-design/fluid-strategies.ts)                       |
| `single-fluid-output-trunk` | One output fluid; zero to four solid inputs and no solid output. Includes a fluid-only no-input producer and can divide one high-rate item between near and far belts.                                                                                                           | [fluid strategies](../src/compute/assembler-design/fluid-strategies.ts)                       |
| `dual-fluid-solid-input`    | One fluid in and one out, plus one or two solid inputs and no solid output. Requires opposing centered fluid ports; solid belts use the remaining side sites and underground crossings. A single high-rate solid may use both sides.                                             | [dual-fluid solid strategies](../src/compute/assembler-design/dual-fluid-solid-strategies.ts) |
| `dual-fluid-solid-output`   | One fluid in and one out, two solid inputs and one solid output, on a 3×3 machine with opposing centered ports. Uses underground input/output belts around the fluid branches; the two solids may share the near belt when they fit separate lanes.                              | [dual-fluid solid strategies](../src/compute/assembler-design/dual-fluid-solid-strategies.ts) |
| `opposing-fluid-trunks`     | One fluid in and one out, no solids. Rotates compatible ports to opposite sides and runs full-height pipe trunks.                                                                                                                                                                | [multi-fluid strategies](../src/compute/assembler-design/multi-fluid-strategies.ts)           |
| `one-fluid-two-outputs`     | One fluid input, two fluid outputs, no solids, with a specific arrangement of three distinct corner boxes on a 3×3 machine. Uses three separate trunks and an underground branch.                                                                                                | [multi-fluid strategies](../src/compute/assembler-design/multi-fluid-strategies.ts)           |
| `adapted-fluid-input`       | Two fluid inputs, up to four solid inputs without a solid output, or up to two with one. Requires a 3×3 machine with two distinct recipe fluids reachable through a lower west port and a rightmost south port after rotation. Uses a four-row adaptor and optional solid belts. | [adaptor](../src/compute/assembler-design/adapted-fluid-input-strategy.ts)                    |

The fluid strategies share rotation and port checks, but most layouts still encode particular
relative positions and crossing patterns. Some ask only for a port facing a side; others require a
centered or exact corner connection. Sources:
[port helpers](../src/compute/assembler-design/fluid-ports.ts),
[fluid strategies](../src/compute/assembler-design/fluid-strategies.ts),
[multi-fluid strategies](../src/compute/assembler-design/multi-fluid-strategies.ts).

## Problem classes exercised

The [30 built-in problems](../src/compute/kernel-problems.ts) are grouped by boundary shape: nine
solid, six fluid-input, seven fluid-output, five with fluid input and output, and three air-filter
footprints. Most use synthetic resource names and a nominal fluid rate of 200/s. `machineProblem`
substitutes the real footprint and fluid boxes of a chemical plant, flare stack, casting machine, or
powderiser. The catalog is displayed in the kernel workspace with throughput based on the chosen
belt and game progress; it is not itself a test that all 30 are feasible at every rate. Sources:
[catalog](../src/compute/kernel-problems.ts),
[catalog assertions](../test/compute/kernel-problems.test.ts),
[kernel workspace](../src/components/kernel-debug.tsx).

| Class                               | Evidence in behavior tests                                                                                                                                                                                                                                                       | Boundary of the evidence                                                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Solid-only, small and wide machines | 2×2 with one or two outputs, 3×3 one-to-three inputs, 5×5 high-rate input, multiple inserters per belt, mixed two-lane input, one input split over two belts, and explicit failures when sites run out. [Tests](../test/compute/assembler-design/only-solids.test.ts)            | The compact two-output case is a filtered two-belt arrangement; wide output has only one product.                  |
| One fluid input                     | Solid input/output variants, machine rotation, rectangular footprints, and a flare-stack sink with no output transport. [Tests](../test/compute/assembler-design/with-fluids.test.ts)                                                                                            | Port existence and the chosen right-side inserter sites govern success.                                            |
| One fluid output                    | A no-input fluid producer, solid-fed furnaces including a CPU-cell molten-silicon rate, high-rate splitting, three solid inputs feeding two belts, and a separate three-input/one-solid-output outside-trunk case. [Tests](../test/compute/assembler-design/with-fluids.test.ts) | These are distinct layouts with different flow limits; they do not establish arbitrary-count fluid-output support. |
| Fluid input **and** output          | Opposing trunks on 3×3, 3×5, 5×3 and 5×5 machines; one or two solid inputs; and the 3×3 two-solid/one-solid-output crossing. [Tests](../test/compute/assembler-design/with-fluids.test.ts)                                                                                       | More complex mixed flows require the exact port arrangements described above.                                      |
| Three fluid networks                | Chemical-plant air separation checks that two output fluids stay independent and the input is connected; an altered output port on the input-trunk side is rejected. [Tests](../test/compute/assembler-design/with-fluids.test.ts)                                               | The generated variant has no solid transport, unlike the full rectangular blueprint reference.                     |
| Two input fluids needing an adaptor | Mono-silicon casting geometry, output and no-output forms, up to four solid inputs, rotated ports, recipe fluid-box mapping, three adjacent copies, and capacity/port failures. [Tests](../test/compute/assembler-design/adapted-fluid-input.test.ts)                            | This is a specific four-row port wrapper, not an arbitrary pipe router.                                            |

Tests check selected entity layouts, collision status and bounds, some belt stack limits, and
selected fluid traces. The adaptor test explicitly traces three adjacent copies; the air-separation
test checks distinct trunk fluids. These checks are narrower than the full periodic validation list
in the [blueprint notes](blueprints/ASSEMBLERS.md): the generator does not run a general collision,
lane, transfer, fluid-network, underground-pair, and encoding validator before returning a
candidate. Sources: [solid tests](../test/compute/assembler-design/only-solids.test.ts),
[fluid tests](../test/compute/assembler-design/with-fluids.test.ts),
[adaptor tests](../test/compute/assembler-design/adapted-fluid-input.test.ts),
[generator](../src/compute/assembler-design.ts).

## Known limits relevant to generalisation and reuse

- **One-machine stock kernels.** The two-assembler, two-output-lane snake is documented but not
  generated. There is no composition of multiple assemblers or direct insertion between them.
  Sources: [entry point](../src/compute/assembler-design.ts),
  [snake fixture](blueprints/ASSEMBLERS.md).
- **Pattern-specific fluid routing.** A port can be rotated into a permitted side, but no search
  routes arbitrary fluid-box positions around belts and inserters. The three-fluid variant requires
  exact corners; the adaptor requires its lower and side ports; several mixed strategies require
  opposing centered ports or a 3×3 footprint. Sources:
  [port checks](../src/compute/assembler-design/fluid-ports.ts),
  [multi-fluid](../src/compute/assembler-design/multi-fluid-strategies.ts),
  [adaptor](../src/compute/assembler-design/adapted-fluid-input-strategy.ts),
  [outside trunk](../src/compute/assembler-design/outside-fluid-strategy.ts).
- **Limited flow combinations.** No stock strategy accepts arbitrary numbers of fluid networks or
  solid products. The only two-solid-output strategy is compact and solid-only. Input grouping in
  `wide-solid` follows input order and pairs adjacent rates when both fit half a belt; it does not
  search every lane packing. Sources: [strategy registry](../src/compute/assembler-design.ts),
  [solid grouping](../src/compute/assembler-design/solid-strategies.ts).
- **Rate and routing assumptions are supplied externally.** The generator checks its caller's three
  throughput numbers; it does not select an inserter prototype, calculate its reach or speed, route
  upstream item lanes, check fluid throughput, or prove that a repeated column fits its peak lane
  load. The preview calculates a separate belt/physical stack limit after generation. Sources:
  [throughput contract](../src/compute/assembler-design/strategy.ts),
  [kernel workspace](../src/components/kernel-debug.tsx),
  [stack limit](../src/components/design/design-stack-limit.ts),
  [blueprint rate and validation requirements](blueprints/ASSEMBLERS.md).
- **Candidate validation is external and partial.** The entry point trusts strategies' returned
  designs. The fluid tracer notes that input supply is currently checked against any connected input
  fluid box, rather than every recipe fluid's assigned box. The adaptor itself does use recipe-fluid
  assignments, including explicit indexes, to distinguish its two inputs. Sources:
  [entry point](../src/compute/assembler-design.ts),
  [fluid trace](../src/components/design/design-fluid-traces.ts),
  [adaptor](../src/compute/assembler-design/adapted-fluid-input-strategy.ts).
- **Failure selection is registration-dependent.** Each strategy can reject a constraint, but the
  first rejection is reported if all candidates fail. A new strategy or changed registration order
  can therefore change the message without changing feasibility. Source:
  [selection](../src/compute/assembler-design.ts).

The review can use the table above to distinguish reusable pieces (problem contract, throughput
checks, rotation helpers, and a few composed solid/fluid patterns) from layouts whose success
depends on a particular port, footprint, or flow count. The cited tests demonstrate those classes at
selected rates; they do not establish a general solution for every recipe matching a broad
description in the blueprint notes.
