import { staticData } from '../data/decode.ts';
import type { StaticData } from '../types.ts';

/** Identifies one exact generated data artifact and its prototype ordering. */
export type DatasetId = string;

/** The app-lifetime data selected before the planner boots. */
export interface Dataset {
  readonly id: DatasetId;
  readonly data: StaticData;
}

export function createDataset(id: DatasetId, data: StaticData): Dataset {
  return { id, data };
}

/** Compatibility fixture until dataset assets and derived indexes move here. */
export const defaultDataset = createDataset('bobang-r4q', staticData);
