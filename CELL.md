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

## Where this is now

Built: the data structure (`src/cell.ts`), the cells in `UrlState`, the box which draws one
(`src/components/cell/`), the search vocabulary for refining a cell — `makes:@in` / `uses:@out` over
the cell's own open edges, which is the "adding recipes that makes: or uses: items from the input or
output set" step above — and the solvers under `src/solve/`, which perform the "attempt to scale one
of the recipes to match the other" step.

The default matrix solver balances every internal resource simultaneously, including cycles. It will
not choose between alternative recipes, and inconsistent pins or an underdetermined system do not
have to produce a complete answer — pinned counts remain in place, their rates still show on the
cell's edges, and the problem is written out under the rows. The demand-propagation `dumbSolver`
remains as a simpler alternative without cycle support. "Not always possible, and will be resolved
later" is the design, not a gap in it: what the app owes the user there is a sentence saying which
number to type, and that is what a `SolveNote` is.

A row also carries what is in its machine's slots (`CellEntry.modules`), and the rates it is solved
at are that loadout's: speed changes how many crafts a machine gets through, productivity changes
what comes out of them without changing what goes in. The bonus is paid only on the part of a
product the recipe actually made — `Product.ignoredByProductivity` is the catalyst it borrowed and
handed back — so a garden which turns one garden into two grows one of them, whatever is in the
slots.

Not built: the catalyst-specific rules for a catalyst which goes round a cycle of two recipes, and
any notion of a cell's rates being a _target_ — you scale the cell by pinning a machine count, not
by asking for 9 steel a second.
