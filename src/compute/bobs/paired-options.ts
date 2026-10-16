import type { BobOptions } from './types.ts';

export interface BobPairOptions extends BobOptions {
  pairingSeconds: number;
  annealingSeconds: number;
  pairingCapacity: number;
}
export const defaultBobPairOptions = {
  pairingSeconds: 5,
  annealingSeconds: 5,
  pairingCapacity: 144,
};
