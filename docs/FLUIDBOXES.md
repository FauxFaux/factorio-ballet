# Crafting-machine fluid-box assignment

This note records how a recipe's fluid ingredients and products appear to map onto a crafting
machine's prototype fluid boxes. Factorio documents the pieces of this mechanism, but not the full
allocation algorithm used when a recipe does not specify fluid-box indexes. The allocation rule
below is therefore a theory derived from observed game behaviour. Keep that distinction when using
it in the planner.

## Documented model

A crafting machine declares an ordered `fluid_boxes` array. Each `FluidBox` has a
`production_type` (`input`, `output`, `input-output`, or `none`) and one or more physical pipe
connections. Multiple pipe connections within one prototype box expose the same storage; they are
not separate recipe slots.

A fluid ingredient or product may set `fluidbox_index`. The prototype API says that this index is
1-based, is counted separately for input and output boxes, and selects one box. Its default is `0`,
meaning that no particular box was selected. Current Factorio also supports
`optional_fluidbox_indexes`, which adds further boxes to an explicitly indexed fluid. The
Bob's/Angel's dump used by this repository contains no `optional_fluidbox_indexes` values.

Sources:

- [CraftingMachinePrototype fluid boxes](https://lua-api.factorio.com/latest/prototypes/CraftingMachinePrototype.html#fluid_boxes)
- [FluidIngredientPrototype `fluidbox_index`](https://lua-api.factorio.com/latest/types/FluidIngredientPrototype.html#fluidbox_index)
- [FluidProductPrototype `fluidbox_index`](https://lua-api.factorio.com/latest/types/FluidProductPrototype.html#fluidbox_index)
- [FluidProductPrototype `optional_fluidbox_indexes`](https://lua-api.factorio.com/latest/types/FluidProductPrototype.html#optional_fluidbox_indexes)

Recipe selection can merge several machine prototype boxes into one runtime fluid storage. The
runtime API explicitly says that `LuaEntity::get_fluid_box_prototype()` can return an array when a
crafting machine's fluid box was created by merging multiple prototypes. A Factorio developer's
description of `FluidBoxManager` likewise says that a recipe may merge several prototype boxes or
select specific ones using custom fluid indexes.

Sources:

- [`LuaEntity::get_fluid_box_prototype`](https://lua-api.factorio.com/latest/classes/LuaEntity.html#get_fluid_box_prototype)
- [Factorio developer explanation of crafting-machine `FluidBoxManager`](https://forums.factorio.com/viewtopic.php?t=104036)

The same API documentation is available in the local snapshot at
`~/code/factorio-save-parser/docs/lua-api` (version 2.1.17 at the time of this investigation).

## Evidence from the game

The following results were observed directly in the Bob's/Angel's game represented by the checked-in
dataset.

### Exact fit: `angels-condensates-oil-refining`

The recipe has two unindexed fluid inputs and three unindexed fluid outputs. The oil refinery has
two input boxes followed by three output boxes. All five ports are active, with the fluids assigned
in recipe order:

```text
input 1   crude oil
input 2   liquid condensates
output 1  liquid mineral oil
output 2  liquid fuel oil
output 3  liquid naphtha
```

This establishes ordered assignment when the number of recipe fluids exactly matches the available
boxes on each side.

### One fluid fills a side: `angels-gas-nitrogen-dioxide`

The recipe has two unindexed fluid inputs and one unindexed fluid output. In a chemical plant, which
has two input and two output prototype boxes, the game exposes nitrogen dioxide through both output
ports. The two output prototype boxes therefore become one compound runtime fluid storage for the
single product.

This establishes that an unindexed fluid is not necessarily assigned to only one prototype box.

### Uneven division: `angels-liquid-vegetable-oil-refining`

The recipe has one unindexed input and two unindexed outputs. In an oil refinery, which has two
input and three output prototype boxes, the observed assignment is:

```text
input 1 + input 2    liquid vegetable oil
output 1 + output 2  liquid fuel oil (the first recipe product)
output 3             liquid mineral oil (the second recipe product)
```

Thus spare boxes are not left unused. They are merged into compound runtime boxes, and an uneven
remainder goes to the earlier fluid in recipe order.

## Inferred unindexed allocation rule

The observations are consistent with treating inputs and outputs independently and partitioning
the remaining compatible prototype boxes into contiguous groups for the remaining unindexed recipe
fluids. At each step, the next fluid receives:

```ts
Math.ceil(remainingBoxes / remainingFluids)
```

boxes from the front of the ordered list.

This predicts:

| Prototype boxes | Recipe fluids | Group sizes |
| --------------- | ------------- | ----------- |
| 2               | 1             | 2           |
| 2               | 2             | 1, 1        |
| 3               | 1             | 3           |
| 3               | 2             | 2, 1        |
| 3               | 3             | 1, 1, 1     |

All three observed recipes agree with this rule. It also explains why recipe order determines which
fluid receives the larger group when the division is uneven.

This exact formula has not been found in the prototype or runtime API documentation. It should be
treated as a testable model of Factorio's behaviour, not as a documented compatibility guarantee.
Before generalising it to machines with more boxes or unusual mixes of indexed and unindexed fluids,
add targeted in-game observations or query the runtime entity's merged prototypes.

## Explicit indexes

An explicit positive `fluidbox_index` selects a particular box in its side-specific namespace and
must take precedence over implicit grouping. Examples in the checked-in dump include
`basic-oil-processing`, which selects output index 3, and `bob-sodium-carbonate`, whose products
explicitly select output indexes 2 and 1.

The unresolved case is the precise interaction between explicitly claimed boxes and unindexed
fluids. A plausible planner model is to remove explicitly claimed boxes and apply the contiguous
partition rule to the remaining compatible boxes, but that extension is not established by the
three observations above and needs an in-game fixture before being relied upon.

## Implication for the planner

The planner must represent a recipe fluid as mapping to one or more machine prototype boxes. A
one-to-one `fluid -> first unclaimed box` fallback cannot reproduce the game:

- it omits the second nitrogen-dioxide output port;
- it omits the second vegetable-oil input port; and
- it assigns only the left output to fuel oil instead of the observed left-and-centre pair.

For rendering, every physical connection of every box in the selected group carries the group's
fluid. For layout decisions, those connections are alternative access points to the same runtime
storage, rather than independent fluids or independent recipe outputs.
