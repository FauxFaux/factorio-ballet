import type { SplitProblem } from './placement-milp.ts';

/** User-supplied solved processing-unit cell. Rates are totals, not per-machine rates.
 * These dimensions/capacities are abstract envelopes, without kernel port metadata. */
export const processingUnitProblem: SplitProblem = {
  inputs: [
    { material: 'fluid:sulfuric-acid', rate: 42 },
    { material: 'item:plastic-bar', rate: 16.8 },
    { material: 'fluid:molten-copper', rate: 408.94736842105254 },
    { material: 'fluid:molten-iron', rate: 486.31578947368416 },
  ],
  outputs: [{ material: 'item:processing-unit', rate: 16.8 }],
  recipes: [
    {
      recipe: 'processing-unit',
      count: 24,
      inputs: [
        { material: 'item:electronic-circuit', rate: 168 },
        { material: 'fluid:sulfuric-acid', rate: 42 },
        { material: 'item:advanced-circuit', rate: 16.8 },
      ],
      outputs: [{ material: 'item:processing-unit', rate: 16.8 }],
      layoutOptions: [
        { size: { width: 10, height: 4 }, capacity: 16 },
        { size: { width: 5, height: 12 }, capacity: 16 },
        { size: { width: 8, height: 4 }, capacity: 8 },
        { size: { width: 5, height: 8 }, capacity: 8 },
        { size: { width: 5, height: 12 }, capacity: 8 },
        { size: { width: 8, height: 4 }, capacity: 4 },
        { size: { width: 5, height: 8 }, capacity: 4 },
        { size: { width: 5, height: 12 }, capacity: 4 },
      ],
    },
    {
      recipe: 'electronic-circuit',
      count: 13.2,
      inputs: [
        { material: 'item:copper-cable', rate: 277.2 },
        { material: 'item:iron-plate', rate: 92.4 },
      ],
      outputs: [{ material: 'item:electronic-circuit', rate: 184.8 }],
      layoutOptions: [
        { size: { width: 7, height: 8 }, capacity: 8 },
        { size: { width: 7, height: 12 }, capacity: 8 },
        { size: { width: 9, height: 4 }, capacity: 4 },
        { size: { width: 4, height: 8 }, capacity: 4 },
        { size: { width: 4, height: 12 }, capacity: 4 },
        { size: { width: 7, height: 4 }, capacity: 2 },
        { size: { width: 4, height: 8 }, capacity: 2 },
        { size: { width: 4, height: 12 }, capacity: 2 },
        { size: { width: 7, height: 4 }, capacity: 1 },
        { size: { width: 4, height: 8 }, capacity: 1 },
      ],
    },
    {
      recipe: 'casting-copper-cable',
      count: 10.761772853185594,
      inputs: [{ material: 'fluid:molten-copper', rate: 408.94736842105254 }],
      outputs: [{ material: 'item:copper-cable', rate: 310.8 }],
      layoutOptions: [
        { size: { width: 6, height: 9 }, capacity: 8 },
        { size: { width: 12, height: 5 }, capacity: 4 },
        { size: { width: 6, height: 9 }, capacity: 4 },
        { size: { width: 9, height: 5 }, capacity: 2 },
        { size: { width: 6, height: 9 }, capacity: 2 },
        { size: { width: 8, height: 5 }, capacity: 1 },
      ],
    },
    {
      recipe: 'casting-iron',
      count: 10.238227146814404,
      inputs: [{ material: 'fluid:molten-iron', rate: 486.31578947368416 }],
      outputs: [{ material: 'item:iron-plate', rate: 92.4 }],
      layoutOptions: [
        { size: { width: 6, height: 9 }, capacity: 9 },
        { size: { width: 11, height: 5 }, capacity: 8 },
        { size: { width: 6, height: 9 }, capacity: 6 },
        { size: { width: 9, height: 5 }, capacity: 4 },
        { size: { width: 8, height: 5 }, capacity: 3 },
        { size: { width: 6, height: 9 }, capacity: 3 },
      ],
    },
    {
      recipe: 'advanced-circuit',
      count: 14.4,
      inputs: [
        { material: 'item:copper-cable', rate: 33.6 },
        { material: 'item:electronic-circuit', rate: 16.8 },
        { material: 'item:plastic-bar', rate: 16.8 },
      ],
      outputs: [{ material: 'item:advanced-circuit', rate: 16.8 }],
      layoutOptions: [
        { size: { width: 9, height: 4 }, capacity: 16 },
        { size: { width: 4, height: 12 }, capacity: 16 },
        { size: { width: 7, height: 4 }, capacity: 12 },
        { size: { width: 4, height: 8 }, capacity: 12 },
        { size: { width: 4, height: 12 }, capacity: 12 },
      ],
    },
  ],
};
