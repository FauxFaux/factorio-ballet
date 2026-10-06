import './layout.css';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { TALA } from '../../assets/tala/index.js';
import type { LayoutResult } from '../../assets/tala/index.js';
import { buildRailBrick } from '../../bp/rail-blueprint.ts';
import { recipeName, resourceName } from '../../data/index.ts';
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
import { elkLayout } from './elk-layout.ts';

const NO_MODULES: FactoryModule[] = [];
const NO_CONNECTIONS: AttachedModuleConnection[] = [];
const NO_STATION_CONNECTIONS: AttachedStationConnection[] = [];

let talaInstance: Promise<TALA> | undefined;
type LayoutAlgorithm = 'tala' | 'elk';
type CachedLayout = { promise: Promise<LayoutResult>; result?: LayoutResult };
const layoutCache = new Map<string, CachedLayout>();
const MAX_CACHED_LAYOUTS = 32;

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

function cachedLayout(
  algorithm: LayoutAlgorithm,
  graph: ReturnType<typeof talaGraph>,
): CachedLayout {
  const key = `${algorithm}:${JSON.stringify(graph)}`;
  const cached = layoutCache.get(key);
  if (cached) {
    layoutCache.delete(key);
    layoutCache.set(key, cached);
    return cached;
  }
  const entry: CachedLayout = {
    promise: Promise.resolve().then(() =>
      algorithm === 'tala' ? tala().then((instance) => instance.layout(graph)) : elkLayout(graph),
    ),
  };
  layoutCache.set(key, entry);
  void entry.promise.then(
    (result) => {
      entry.result = result;
    },
    () => {
      if (layoutCache.get(key) === entry) layoutCache.delete(key);
    },
  );
  if (layoutCache.size > MAX_CACHED_LAYOUTS) layoutCache.delete(layoutCache.keys().next().value!);
  return entry;
}

function talaViewBox(result: LayoutResult, nodeNames: ReadonlyMap<string, string>): string {
  const xs = result.nodes.flatMap(({ x, width }) => [x, x + width]);
  const ys = result.nodes.flatMap(({ y, height }) => [y, y + height]);
  for (const node of result.nodes) {
    const labelWidth = (nodeNames.get(node.id) ?? node.id).length * 7;
    xs.push(node.x + node.width / 2 - labelWidth / 2);
    xs.push(node.x + node.width / 2 + labelWidth / 2);
    ys.push(node.y - 16);
  }
  for (const edge of result.edges) {
    for (const point of edge.points) {
      xs.push(point.x);
      ys.push(point.y);
    }
  }
  const padding = 20;
  const minX = xs.length ? Math.min(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  const left = minX - padding;
  const top = minY - padding;
  const width = Math.max(1, Math.max(...xs) - minX) + padding * 2;
  const height = Math.max(1, Math.max(...ys) - minY) + padding * 2;
  return `${left} ${top} ${width} ${height}`;
}

/** The initial, intentionally empty surface for a cell's factory layout. */
export function CellLayoutSurface({
  layout,
  onFrozenModulesChange,
  inputs,
  outputs,
  modules = NO_MODULES,
  connections = NO_CONNECTIONS,
  stationConnections = NO_STATION_CONNECTIONS,
  stackedStations = stackedRailStations(inputs.length, outputs.length),
  zeroInputRegionRecipes,
}: {
  layout: CellLayout;
  onFrozenModulesChange?: (positions: NonNullable<CellLayout['frozenModules']>) => void;
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
  const nodeNames = new Map<string, string>();
  const nodeDescriptions = new Map<string, string>();
  modules.forEach((module, index) => {
    const products = Object.entries(module.outputs)
      .filter(([, rate]) => rate > 0)
      .map(([resource]) => resourceName(data, resource as ResourceId));
    const firstProduct = data.recipes[module.recipe]?.products[0]?.resource;
    const name =
      products[0] ??
      (firstProduct ? resourceName(data, firstProduct) : recipeName(data, module.recipe));
    const id = `module_${index}`;
    nodeNames.set(id, name);
    nodeDescriptions.set(
      id,
      `${recipeName(data, module.recipe)}: ${products.join(', ') || name}; ${module.size.width}×${module.size.height} tiles`,
    );
  });
  inputs.forEach((resource, index) =>
    nodeNames.set(`input_${index}`, `Input: ${resourceName(data, resource)}`),
  );
  outputs.forEach((resource, index) =>
    nodeNames.set(`output_${index}`, `Output: ${resourceName(data, resource)}`),
  );
  const [algorithm, setAlgorithm] = useState<LayoutAlgorithm>('tala');
  const [layoutState, setLayoutState] = useState<{
    key: string;
    result?: LayoutResult;
    error?: string;
  } | null>(null);
  const layoutKey = `${algorithm}:${JSON.stringify(graph)}`;
  const cachedResult = layoutCache.get(layoutKey)?.result;
  const output = cachedResult ?? (layoutState?.key === layoutKey ? layoutState.result : undefined);
  const status = layoutState?.key === layoutKey ? layoutState.error : undefined;
  useEffect(() => {
    if (!modules.length) {
      setLayoutState(null);
      return;
    }
    let current = true;
    const entry = cachedLayout(algorithm, graph);
    if (entry.result) setLayoutState({ key: layoutKey, result: entry.result });
    else setLayoutState({ key: layoutKey });
    void entry.promise
      .then((result) => {
        if (current) setLayoutState({ key: layoutKey, result });
      })
      .catch((error: unknown) => {
        if (current)
          setLayoutState({
            key: layoutKey,
            error: `${algorithm.toUpperCase()} layout failed: ${String(error)}`,
          });
      });
    return () => {
      current = false;
    };
  }, [algorithm, graph, layoutKey, modules.length]);

  return (
    <div class="cell-layout-panel">
      <section class="cell-layout" aria-label="Layout">
        <RailBlueprintPreview blueprint={blueprint.blueprint} embedded />
        <ModuleFootprints
          frozenModules={layout.frozenModules}
          onFrozenModulesChange={onFrozenModulesChange}
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
      {modules.length > 0 && (
        <label class="cell-layout-algorithm">
          <span class={algorithm === 'tala' ? 'is-selected' : undefined}>TALA</span>
          <input
            type="checkbox"
            role="switch"
            aria-label="Use ELK layout"
            checked={algorithm === 'elk'}
            onChange={(event) => setAlgorithm(event.currentTarget.checked ? 'elk' : 'tala')}
          />
          <span class={algorithm === 'elk' ? 'is-selected' : undefined}>ELK</span>
        </label>
      )}
      {modules.length > 0 && !output && !status && (
        <p class="cell-layout-tala-status">Running {algorithm.toUpperCase()}…</p>
      )}
      {status && <p class="cell-layout-tala-status">{status}</p>}
      {output && (
        <svg
          class="cell-layout-tala-output"
          role="img"
          aria-label={`${algorithm.toUpperCase()} layout`}
          viewBox={talaViewBox(output, nodeNames)}
        >
          {output.edges.map((edge) => (
            <polyline
              key={edge.id}
              class="cell-layout-tala-edge"
              data-tala-edge={edge.id}
              points={edge.points.map(({ x, y }) => `${x},${y}`).join(' ')}
            >
              <title>{edge.id}</title>
            </polyline>
          ))}
          {output.nodes.map((node) => (
            <g key={node.id} data-tala-node={node.id}>
              <title>{nodeDescriptions.get(node.id) ?? nodeNames.get(node.id) ?? node.id}</title>
              <rect
                class={`cell-layout-tala-node${node.id.startsWith('input_') ? ' is-input' : ''}${node.id.startsWith('output_') ? ' is-output' : ''}`}
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
              />
              <text
                class="cell-layout-tala-label"
                x={node.x + node.width / 2}
                y={node.y - 4}
                text-anchor="middle"
              >
                {nodeNames.get(node.id) ?? node.id}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}
