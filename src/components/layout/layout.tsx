import './layout.css';
import { useMemo } from 'preact/hooks';
import { buildRailBrick } from '../../bp/rail-blueprint.ts';
import { RailBlueprintPreview } from '../rail-blueprint-preview.tsx';
import {
  InputStationFootprints,
  OutputStationFootprints,
  inputStationFootprintStops,
  outputStationFootprintStops,
} from './station-footprint.tsx';
import type { CellLayout } from '../../compute/layout.ts';
import type { FactoryModule } from '../../compute/modules.ts';
import type { ResourceId } from '../../types.ts';
import { stackedRailStations } from '../cell/rail-mode.ts';
import { ModuleFootprints } from './module-footprints.tsx';

/** The initial, intentionally empty surface for a cell's factory layout. */
export function CellLayoutSurface({
  layout: _layout,
  inputs,
  outputs,
  modules = [],
  stackedStations = stackedRailStations(inputs.length, outputs.length),
}: {
  layout: CellLayout;
  inputs: ResourceId[];
  outputs: ResourceId[];
  modules?: FactoryModule[];
  /** Uses the same input-station arrangement as the cell's embedded rail radar. */
  stackedStations?: boolean;
}) {
  const blueprint = useMemo(
    () => buildRailBrick(stackedStations ? -inputs.length : inputs.length, outputs.length),
    [inputs.length, outputs.length, stackedStations],
  );
  if (!('blueprint' in blueprint)) throw new Error('rail brick builder returned a book');
  const stationStops = useMemo(
    () => inputStationFootprintStops(blueprint.blueprint, inputs.length, stackedStations),
    [blueprint, inputs.length, stackedStations],
  );
  const outputStationStops = useMemo(
    () => outputStationFootprintStops(blueprint.blueprint, outputs.length),
    [blueprint, outputs.length],
  );

  return (
    <section class="cell-layout" aria-label="Layout">
      <RailBlueprintPreview blueprint={blueprint.blueprint} embedded />
      <ModuleFootprints modules={modules} />
      <InputStationFootprints stops={stationStops} />
      <OutputStationFootprints stops={outputStationStops} />
    </section>
  );
}
