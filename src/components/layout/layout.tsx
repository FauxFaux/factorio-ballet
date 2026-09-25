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
import type {
  AttachedModuleConnection,
  AttachedStationConnection,
} from '../../compute/module-port-connections.ts';
import type { ResourceId } from '../../types.ts';
import { useDataset } from '../../dataset/context.tsx';
import { stackedRailStations } from '../cell/rail-mode.ts';
import { ModuleFootprints } from './module-footprints.tsx';

/** The initial, intentionally empty surface for a cell's factory layout. */
export function CellLayoutSurface({
  layout: _layout,
  inputs,
  outputs,
  modules = [],
  connections = [],
  stationConnections = [],
  stackedStations = stackedRailStations(inputs.length, outputs.length),
  zeroInputRegionRecipes,
}: {
  layout: CellLayout;
  inputs: ResourceId[];
  outputs: ResourceId[];
  modules?: FactoryModule[];
  connections?: AttachedModuleConnection[];
  stationConnections?: AttachedStationConnection[];
  /** Uses the same input-station arrangement as the cell's embedded rail radar. */
  stackedStations?: boolean;
  zeroInputRegionRecipes?: ReadonlySet<string>;
}) {
  const { data } = useDataset();
  const blueprint = useMemo(
    () => buildRailBrick(stackedStations ? -inputs.length : inputs.length, outputs.length),
    [inputs.length, outputs.length, stackedStations],
  );
  if (!('blueprint' in blueprint)) throw new Error('rail brick builder returned a book');
  const stationStops = useMemo(
    () => inputStationFootprintStops(blueprint.blueprint, inputs.length, stackedStations, data),
    [blueprint, inputs.length, stackedStations, data],
  );
  const outputStationStops = useMemo(
    () => outputStationFootprintStops(blueprint.blueprint, outputs.length, data),
    [blueprint, outputs.length, data],
  );

  return (
    <section class="cell-layout" aria-label="Layout">
      <RailBlueprintPreview blueprint={blueprint.blueprint} embedded />
      <ModuleFootprints
        modules={modules}
        connections={connections}
        stationConnections={stationConnections}
        inputStationStops={stationStops}
        outputStationStops={outputStationStops}
        zeroInputRegionRecipes={zeroInputRegionRecipes}
      />
      <InputStationFootprints stops={stationStops} resources={inputs} />
      <OutputStationFootprints stops={outputStationStops} resources={outputs} />
    </section>
  );
}
