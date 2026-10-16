import type { BobOptions } from './types.ts';

export interface BobPlacementOptions {
  boundaryEdges: 'any' | 'left-right';
  breakSymmetry: boolean;
  balanceWeight: number;
}

export interface BobPairOptions extends BobOptions, BobPlacementOptions {
  pairingSeconds: number;
  annealingSeconds: number;
  pairingCapacity: number;
}
export const defaultBobPairOptions = {
  boundaryEdges: 'left-right' as BobPlacementOptions['boundaryEdges'],
  breakSymmetry: true,
  balanceWeight: 1,
  pairingSeconds: 5,
  annealingSeconds: 5,
  pairingCapacity: 144,
};
