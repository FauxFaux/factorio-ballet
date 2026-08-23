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
