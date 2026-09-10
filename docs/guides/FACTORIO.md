Factorio is a factory management game.

The aim is to design a 'process' which can convert an input/requirement into an output/production,
by applying a set of recipes.

Recipes have inputs, outputs, times, and run in a certain type of building/assembler.

Inputs and outputs are either 'items' or 'fluids'. Fluids can have temperatures, are typically more
voluminous, and travel through pipes with unlimited throughput, so each fluid
type needs only one pipe. Items stay on belts whose progress-dependent throughput ranges from 15 to
75 items per second.

For example, we may be tasked with creating 'steel', given 'iron ore', and we could first process
the 'iron ore' into 'iron ingots' in an 'electric furnace', converting 4 'iron ore' into 1 'ingot'
in 2 seconds, and then process the 'iron ingots' into 'steel' in a 'steel furnace', with the
addition of 'coke' and 'oxygen >600 degrees', which converts 2 'iron ingots', 10 'coke' 400
'oxygen >600 degrees' into 3 'steel', in 5 seconds.

The user may ask for 9 'steel' per second, at which point we know we need `9/3*5=15` 'steel
furnaces', and `15*10/5=30` 'coke' per second, and 6 'iron ingots' per second, so 12 'electric
furnaces', etc.

Complexities:

- cycles: some recipe chains consume some of their own output. Processing 10 'rock' may produce 2
  'iron ore', and also 6 'rock'; this 'rock' may need to be fed into the start, so this chain only
  "really" consumes 4 'rock'.
- productivity: some machines can be modified to produce more items; a 10% productivity bonus from a
  machine may change a 1-in, 1-out recipe into a 1-in, 1.1-out.
- catalysts: if a recipe consumes and produces an item or fluid, productivity bonuses will not
  apply. The data can, but does not fully, represent all of the catalyst rules. Be afraid. What it
  does say is per result — `ignored_by_productivity`, ingested as `Product.ignoredByProductivity` —
  and it covers the within-one-recipe case, which is what `productAmount` pays the bonus around. A
  catalyst which goes round a cycle of two recipes is not stated anywhere and is still open.

## Cells

A cell is a unit of work in a factory, or a sub-factory. It's expected that a cell will generally be
closed and scoped:

- all inputs and outputs will be declared and understood
- a human-understandable set of resources will be in the interface (1-8).

The app (page) represents some logically related cells, probably just one.

We can create a cell from a recipe in the search result; this will be the starter recipe. This will
give us inputs and outputs. The user will attempt to refine these inputs and outputs, by adding
recipes that makes: or uses: items from the input or output set.

When we have two recipes in the cell, we will attempt to scale one of the recipes to match the other
recipe, such that there are no additional outputs. This is not always possible, and will be resolved
later.

### Where this is now

Built: the data structure (`src/cell.ts`), the cells in `UrlState`, the box which draws one
(`src/components/cell/`), the search vocabulary for refining a cell — `makes:@in` / `uses:@out` over
the cell's own open edges, which is the "adding recipes that makes: or uses: items from the input or
output set" step above — and the solvers under `src/solve/`, which perform the "attempt to scale one
of the recipes to match the other" step.

The default matrix solver balances every internal resource simultaneously, including cycles. If its
cell declares `exports`, those resources may leave as surplus even when consumed internally. They do
not set machine counts, but their full flows remain visible and a net shortfall is an error. The
resource details let the user toggle this setting; explicit exports appear highlighted in out.
Similarly, `imports` allow an external supply for a shortfall even when the cell produces that
resource; a net surplus is an error. Explicit imports appear highlighted in in. Choosing import
clears export for that resource, and vice versa. Both settings are persisted on the cell. If the
remaining system is inconsistent or underdetermined, it falls back to the demand-propagation
`dumbSolver`, which remains available as a simpler alternative without cycle support. "Not always
possible, and will be resolved later" is the design: what the app owes the user there is a sentence
saying which number to type, and that is what a `SolveNote` is.

A row also carries what is in its machine's slots (`CellEntry.modules`), and the rates it is solved
at are that loadout's: speed changes how many crafts a machine gets through, productivity changes
what comes out of them without changing what goes in. The bonus is paid only on the part of a
product the recipe actually made — `Product.ignoredByProductivity` is the catalyst it borrowed and
handed back — so a garden which turns one garden into two grows one of them, whatever is in the
slots.

Not built: the catalyst-specific rules for a catalyst which goes round a cycle of two recipes, and
any notion of a cell's rates being a _target_ — you scale the cell by pinning a machine count, not
by asking for 9 steel a second.
