import { staticData } from '../data/decode.ts';
import type { ResourceId, StaticData } from '../types.ts';
import type { MachineMatch } from '../data/machines.ts';
import {
  buildMachinesByCategory,
  buildSoleProducerIndex,
  buildSuggestionPlanIndex,
  type SuggestionPlanIndex,
} from './precompute.ts';

/** Identifies one exact generated data artifact and its prototype ordering. */
export type DatasetId = string;

/** The app-lifetime data selected before the planner boots. */
export interface Dataset {
  readonly id: DatasetId;
  readonly data: StaticData;
  readonly machinesByCategory: ReadonlyMap<string, readonly MachineMatch[]>;
  readonly soleProducerByResource: ReadonlyMap<ResourceId, string>;
  readonly suggestionPlans: SuggestionPlanIndex;
}

export function createDataset(id: DatasetId, data: StaticData): Dataset {
  return {
    id,
    data,
    machinesByCategory: buildMachinesByCategory(data),
    soleProducerByResource: buildSoleProducerIndex(data),
    suggestionPlans: buildSuggestionPlanIndex(data),
  };
}

/** Compatibility fixture until dataset assets and derived indexes move here. */
export const defaultDataset = createDataset('bobang-r4q', staticData);
