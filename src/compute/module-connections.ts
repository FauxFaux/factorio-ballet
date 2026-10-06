import { searchModuleFlows } from './placement-plan/flow-search.ts';
import type { ResourceId } from '../types.ts';
import type { FactoryModule } from './modules.ts';

/** A directed share of one resource's production assigned to a consuming module. */
export interface ModuleConnection {
  producerId: string;
  consumerId: string;
  resource: ResourceId;
  rate: number;
}

export interface ModuleResourceRemainder {
  moduleId: string;
  resource: ResourceId;
  rate: number;
}

/** Internal transfers and the rates still needing an external source or destination. */
export interface ModuleFlowAllocation {
  connections: ModuleConnection[];
  unmetInputs: ModuleResourceRemainder[];
  unusedOutputs: ModuleResourceRemainder[];
}

/** A remaining module flow assigned to the cell's matching external station. */
export interface StationConnection {
  stationId: string;
  stationIndex: number;
  moduleId: string;
  resource: ResourceId;
  rate: number;
  side: 'input' | 'output';
}

export interface CellFlowAllocation extends ModuleFlowAllocation {
  stationConnections: StationConnection[];
}

/** Match conserved gross rates using bounded sparse-support search. */
export function allocateModuleFlows(
  modules: readonly FactoryModule[],
  resources: readonly ResourceId[],
): ModuleFlowAllocation {
  return searchModuleFlows(modules, resources).allocation;
}

/** Assign internal remainders to declared input and output stations by resource. */
export function connectStationFlows(
  allocation: ModuleFlowAllocation,
  inputResources: readonly ResourceId[],
  outputResources: readonly ResourceId[],
): CellFlowAllocation {
  const inputStations = new Map(inputResources.map((resource, index) => [resource, index]));
  const outputStations = new Map(outputResources.map((resource, index) => [resource, index]));
  const result: CellFlowAllocation = {
    connections: allocation.connections,
    stationConnections: [],
    unmetInputs: [],
    unusedOutputs: [],
  };
  for (const remainder of allocation.unmetInputs) {
    const stationIndex = inputStations.get(remainder.resource);
    if (stationIndex === undefined) {
      result.unmetInputs.push(remainder);
      continue;
    }
    result.stationConnections.push({
      stationId: `station:import:${remainder.resource}`,
      stationIndex,
      moduleId: remainder.moduleId,
      resource: remainder.resource,
      rate: remainder.rate,
      side: 'input',
    });
  }
  for (const remainder of allocation.unusedOutputs) {
    const stationIndex = outputStations.get(remainder.resource);
    if (stationIndex === undefined) {
      result.unusedOutputs.push(remainder);
      continue;
    }
    result.stationConnections.push({
      stationId: `station:export:${remainder.resource}`,
      stationIndex,
      moduleId: remainder.moduleId,
      resource: remainder.resource,
      rate: remainder.rate,
      side: 'output',
    });
  }
  return result;
}
