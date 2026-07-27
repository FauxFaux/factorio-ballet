Factorio is a factory management game.

The aim is to design a 'process' which can convert an input/requirement into an output/production,
by applying a set of recipes.

Recipes have inputs, outputs, times, and run in a certain type of building/assembler.

Inputs and outputs are either 'items' or 'fluids'. 'fluids' can have temperatures, and are typically
more voluminous.

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
  apply.
