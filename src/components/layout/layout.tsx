import './layout.css';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { TALA } from '../../assets/tala/index.js';
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
import { talaGraph } from './tala-graph.ts';

const NO_MODULES: FactoryModule[] = [];
const NO_CONNECTIONS: AttachedModuleConnection[] = [];
const NO_STATION_CONNECTIONS: AttachedStationConnection[] = [];

let talaInstance: Promise<TALA> | undefined;

function tala(): Promise<TALA> {
  talaInstance ??= Promise.resolve()
    .then(async () => {
      const instance = new TALA();
      await instance.ready;
      return instance;
    })
    .catch((error: unknown) => {
      talaInstance = undefined;
      throw error;
    });
  return talaInstance;
}

/** The initial, intentionally empty surface for a cell's factory layout. */
export function CellLayoutSurface({
  layout: _layout,
  inputs,
  outputs,
  modules = NO_MODULES,
  connections = NO_CONNECTIONS,
  stationConnections = NO_STATION_CONNECTIONS,
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
  const graph = useMemo(
    () => talaGraph(modules, connections, stationConnections, stationStops, outputStationStops),
    [modules, connections, stationConnections, stationStops, outputStationStops],
  );
  const [talaOutput, setTalaOutput] = useState('');
  useEffect(() => {
    if (!modules.length) {
      setTalaOutput('');
      return;
    }
    let current = true;
    setTalaOutput('Running TALA…');
    void tala()
      .then((instance) => instance.layout(graph))
      .then((result) => {
        if (current) setTalaOutput(JSON.stringify(result, null, 2));
      })
      .catch((error: unknown) => {
        if (current) setTalaOutput(`TALA layout failed: ${String(error)}`);
      });
    return () => {
      current = false;
    };
  }, [graph, modules.length]);

  return (
    <div class="cell-layout-panel">
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
      <textarea
        class="cell-layout-tala-output"
        aria-label="TALA layout output"
        readOnly
        value={talaOutput}
      />
    </div>
  );
}
