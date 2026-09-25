import type { ResourceId, StaticData } from '../types.ts';
import type { MachineMatch } from '../data/machines.ts';
import type { ModuleCategory, ModuleMatch } from '../data/modules.ts';
import type { BeaconMatch, BeltMatch } from '../data/index.ts';
import type { Landmark } from '../compute/landmarks.ts';
import {
  buildBeaconTiers,
  buildBeltTiers,
  buildMachinesByCategory,
  buildModuleIndex,
  buildPackLandmarks,
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
  readonly modulesByCategory: ReadonlyMap<string, readonly ModuleMatch[]>;
  readonly moduleCategories: readonly ModuleCategory[];
  readonly packLandmarks: readonly Landmark[];
  readonly beaconTiers: readonly BeaconMatch[];
  readonly beltTiers: readonly BeltMatch[];
  readonly soleProducerByResource: ReadonlyMap<ResourceId, string>;
  readonly suggestionPlans: SuggestionPlanIndex;
}

export function createDataset(id: DatasetId, data: StaticData): Dataset {
  const moduleIndex = buildModuleIndex(data);
  return {
    id,
    data,
    machinesByCategory: buildMachinesByCategory(data),
    modulesByCategory: moduleIndex.byCategory,
    moduleCategories: moduleIndex.categories,
    packLandmarks: buildPackLandmarks(data),
    beaconTiers: buildBeaconTiers(data),
    beltTiers: buildBeltTiers(data),
    soleProducerByResource: buildSoleProducerIndex(data),
    suggestionPlans: buildSuggestionPlanIndex(data),
  };
}

