import type { ItemId, Machine, Resource, StaticData } from '../types.ts';

export interface FuelMatch {
  id: ItemId;
  resource: Resource;
}

/** Absent follows the modpack default; there is no fuel picker yet. */
export type FuelChoice = ItemId | undefined;

export function defaultFuel(data: StaticData): FuelMatch | undefined {
  return chosenFuel(
    data,
    data.resources['item:angels-solid-coke'] ? 'item:angels-solid-coke' : 'item:coal',
  );
}

export function chosenFuel(data: StaticData, choice: FuelChoice): FuelMatch | undefined {
  if (choice === undefined) return defaultFuel(data);
  const resource = data.resources[choice];
  return resource?.fuelValue && resource.fuelCategory ? { id: choice, resource } : undefined;
}

/** The selected item fuel, only where this building can burn it. */
export function burnerFuel(
  machine: Machine | undefined,
  fuel: FuelMatch | undefined,
): FuelMatch | undefined {
  return machine?.burner &&
    machine.burner.power > 0 &&
    machine.burner.effectivity > 0 &&
    fuel?.resource.fuelValue &&
    fuel.resource.fuelCategory &&
    machine.burner.fuelCategories.includes(fuel.resource.fuelCategory)
    ? fuel
    : undefined;
}
