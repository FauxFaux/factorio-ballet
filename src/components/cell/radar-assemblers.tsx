import { entryMachine, entryRecipe, type CellEntry } from '../../cell.ts';
import { resourceName } from '../../data/index.ts';
import { staticData } from '../../data/decode.ts';
import type { Solution } from '../../solve/index.ts';
import type { Belt, ResourceId } from '../../types.ts';
import { iconSprite } from '../icon.tsx';
import { itemRateTotal, recipeConnections } from './connection-calc.ts';
import { stationStop } from './radar-rail.tsx';
import {
  assemblerColumnLayout,
  busConnectionTopLane,
  busLayout,
  stackAssemblerDistricts,
  type AssemblerStack,
  type BusLane,
  type BusLayout,
} from './radar-layout.ts';

const assemblerTopY = 20;
const busBottomY = assemblerTopY - 1;
const transportLaneWidth = 0.75;

/** Draw the solved recipe districts and the bus that connects them. */
export function RadarAssemblers({
  inputs,
  outputs,
  entries,
  solution,
  belt,
  progress,
  startX,
  stackedStations,
}: {
  inputs: ResourceId[];
  outputs: ResourceId[];
  entries: CellEntry[];
  solution: Solution;
  belt: Belt;
  progress: number;
  startX: number;
  stackedStations: boolean;
}) {
  let x = startX;
  const districts = entries
    .map((entry, index) => ({ entry, count: solution.counts[index], index }))
    .toReversed()
    .flatMap(({ entry, count: solvedCount, index }) => {
      const recipe = entryRecipe(entry);
      if (!recipe) return [];
      const machineId = entryMachine(entry, recipe, progress);
      const machine = machineId ? staticData.machines[machineId] : undefined;
      if (!machine) return [];
      const connections = recipeConnections(index, solution);
      const inputFluids = connections.inputs
        .map(({ resource }) => resource)
        .filter((resource) => resource.startsWith('fluid:'));
      const outputResources = connections.outputs.map(({ resource }) => resource);
      return [
        {
          id: `${entry.recipe}-${index}`,
          recipeId: entry.recipe,
          recipeName: recipe.human ?? entry.recipe,
          recipe,
          machineWidth: machine.size.width,
          machineHeight: machine.size.height,
          count: Math.max(1, Math.ceil(solvedCount ?? 1)),
          inputItemRate: itemRateTotal(connections.inputs),
          outputItemRate: itemRateTotal(connections.outputs),
          inputFlows: connections.inputs,
          inputFluids,
          outputFlows: connections.outputs,
          outputFluids: outputResources.filter((resource) => resource.startsWith('fluid:')),
        },
      ];
    });
  const stacks = stackAssemblerDistricts(districts, belt.itemsPerSecond);
  const positionedStacks = stacks.map((stack) => {
    const singleDistrict = stack.districts.length === 1 ? stack.districts[0] : undefined;
    const inputBelts = singleDistrict?.layout.inputBeltsPerColumn ?? stack.externalInputBelts;
    const inputPipes = singleDistrict?.layout.inputPipesPerColumn ?? stack.externalInputPipes;
    const positioned = {
      stack,
      x,
      centerX: x + stack.width / 2,
      inputBeltX: inputTransportArrivalX(x, inputBelts),
      inputPipeX: inputTransportArrivalX(x, inputBelts + inputPipes),
    };
    x += stack.width + 4;
    return positioned;
  });
  const busColumns = stacks.map((stack) => ({
    id: `column:${stack.districts.map(({ id }) => id).join('+')}`,
    inputs: stack.districts.flatMap(({ id, inputFlows }) =>
      inputFlows.map((flow) => ({ ...flow, districtId: id })),
    ),
    outputs: stack.districts.flatMap(({ id, outputFlows }) =>
      outputFlows.map((flow) => ({ ...flow, districtId: id })),
    ),
  }));
  const bus = busLayout(busColumns, inputs, outputs, belt.itemsPerSecond);
  const busX = [8, ...positionedStacks.map(({ centerX }) => centerX), 184];
  const inputStationX = new Map(
    inputs.map((resource, index) => [resource, stationStop('in', index, stackedStations).x]),
  );
  const outputStationX = new Map(
    outputs.map((resource, index) => [resource, stationStop('out', index).x]),
  );
  return (
    <g class="cell-radar-assemblers">
      <g class="cell-radar-bus">
        {bus.lanes.map(({ id, routeId, resource, transport, lane, start, end }) => {
          const startColumn = busColumns[start - 1];
          const positionedStart = positionedStacks[start - 1];
          const startX =
            start === 0
              ? (inputStationX.get(resource) ?? busX[start]!)
              : startColumn?.outputs.some((flow) => flow.resource === resource) && positionedStart
                ? outputTransportDepartureX(
                    positionedStart.x,
                    positionedStart.stack,
                    resource,
                    transport,
                  )
                : busX[start]!;
          const endColumn = busColumns[end - 1];
          const positionedEnd = positionedStacks[end - 1];
          const endX =
            end === busColumns.length + 1
              ? (outputStationX.get(resource) ?? busX[end]!)
              : endColumn?.inputs.some((flow) => flow.resource === resource) && positionedEnd
                ? transport === 'belt'
                  ? positionedEnd.inputBeltX
                  : positionedEnd.inputPipeX
                : busX[end]!;
          return (
            <rect
              class={transport === 'belt' ? 'cell-radar-belt' : 'cell-radar-pipe'}
              key={id}
              data-bus-route={routeId}
              data-resource={resource}
              data-bus-segment="horizontal"
              x={startX}
              y={busBottomY - lane}
              width={Math.max(0, endX - startX)}
              height={transportLaneWidth}
            >
              <title>{resourceName(resource)}</title>
            </rect>
          );
        })}
      </g>
      {positionedStacks.map(({ stack, x }, stackIndex) => {
        const stackInputFlows = stack.districts.flatMap(({ inputFlows }) => inputFlows);
        const inputBeltTop = connectionTopY(bus.lanes, stackInputFlows, 'belt');
        const inputPipeTop = connectionTopY(bus.lanes, stackInputFlows, 'pipe');
        const inputBeltRoutes = busRouteIds(bus, stackInputFlows, 'belt');
        const inputPipeRoutes = busRouteIds(bus, stackInputFlows, 'pipe');
        return (
          <g key={stackIndex} data-column-id={busColumns[stackIndex]?.id}>
            {Array.from({ length: stack.externalInputBelts }, (_, beltIndex) => (
              <rect
                class="cell-radar-belt"
                key={`stack-in-${beltIndex}`}
                x={x + beltIndex}
                y={inputBeltTop}
                width={0.75}
                height={assemblerTopY + stack.height - inputBeltTop}
                data-bus-routes={inputBeltRoutes}
                data-bus-segment="vertical-input"
                data-bus-direction="off-bus"
              />
            ))}
            {Array.from({ length: stack.externalInputPipes }, (_, pipeIndex) => (
              <rect
                class="cell-radar-pipe"
                key={`stack-in-pipe-${pipeIndex}`}
                x={x + stack.externalInputBelts + pipeIndex}
                y={inputPipeTop}
                width={0.75}
                height={assemblerTopY + stack.height - inputPipeTop}
                data-bus-routes={inputPipeRoutes}
                data-bus-segment="vertical-input"
                data-bus-direction="off-bus"
              />
            ))}
            {stack.districts.map(
              ({
                id,
                recipeId,
                recipeName,
                machineWidth,
                machineHeight,
                layout,
                inputFlows,
                outputFlows,
                y,
              }) => (
                <AssemblerColumn
                  key={id}
                  x={x}
                  y={assemblerTopY + y}
                  recipe={recipeId}
                  recipeName={recipeName}
                  machineWidth={machineWidth}
                  machineHeight={machineHeight}
                  layout={layout}
                  inputBeltTop={connectionTopY(bus.lanes, inputFlows, 'belt')}
                  inputPipeTop={connectionTopY(bus.lanes, inputFlows, 'pipe')}
                  outputBeltTop={connectionTopY(bus.lanes, outputFlows, 'belt')}
                  outputPipeTop={connectionTopY(bus.lanes, outputFlows, 'pipe')}
                  inputBeltRoutes={busRouteIds(bus, inputFlows, 'belt')}
                  inputPipeRoutes={busRouteIds(bus, inputFlows, 'pipe')}
                  outputBeltRoutes={busRouteIds(bus, outputFlows, 'belt')}
                  outputPipeRoutes={busRouteIds(bus, outputFlows, 'pipe')}
                  districtId={id}
                  drawInputBelts={stack.districts.length === 1}
                />
              ),
            )}
          </g>
        );
      })}
    </g>
  );
}

function inputTransportArrivalX(stackX: number, lanesThroughBank: number) {
  return lanesThroughBank === 0 ? stackX : stackX + lanesThroughBank - 1 + transportLaneWidth / 2;
}
function outputTransportDepartureX(
  stackX: number,
  stack: AssemblerStack,
  resource: ResourceId,
  transport: BusLane['transport'],
) {
  return Math.min(
    ...stack.districts.flatMap(({ machineWidth, layout, outputFlows }) =>
      outputFlows.some((flow) => flow.resource === resource)
        ? [
            stackX +
              layout.inputTransportWidth +
              layout.inputBeltGap +
              machineWidth +
              layout.outputBeltGap +
              (transport === 'belt' ? layout.outputPipesPerColumn : 0) +
              transportLaneWidth / 2,
          ]
        : [],
    ),
  );
}
function connectionTopY(
  busLanes: BusLane[],
  flows: { resource: ResourceId }[],
  transport: BusLane['transport'],
) {
  const lane = busConnectionTopLane(busLanes, flows, transport);
  return lane === undefined ? assemblerTopY : busBottomY - lane;
}
function busRouteIds(
  bus: BusLayout,
  flows: { resource: ResourceId }[],
  transport: BusLane['transport'],
) {
  const resources = new Set(flows.map(({ resource }) => resource));
  return bus.routes
    .filter((route) => route.transport === transport && resources.has(route.resource))
    .map(({ id }) => id)
    .join(' ');
}

function AssemblerColumn({
  x,
  y,
  recipe,
  recipeName,
  machineWidth,
  machineHeight,
  layout,
  inputBeltTop,
  inputPipeTop,
  outputBeltTop,
  outputPipeTop,
  inputBeltRoutes,
  inputPipeRoutes,
  outputBeltRoutes,
  outputPipeRoutes,
  districtId,
  drawInputBelts = true,
}: {
  x: number;
  y: number;
  recipe: string;
  recipeName: string;
  machineWidth: number;
  machineHeight: number;
  layout: ReturnType<typeof assemblerColumnLayout>;
  inputBeltTop: number;
  inputPipeTop: number;
  outputBeltTop: number;
  outputPipeTop: number;
  inputBeltRoutes: string;
  inputPipeRoutes: string;
  outputBeltRoutes: string;
  outputPipeRoutes: string;
  districtId: string;
  drawInputBelts?: boolean;
}) {
  const iconSize = 12;
  const iconX = x + layout.width / 2 - iconSize / 2;
  const iconY = y + layout.height / 2 - iconSize / 2;
  return (
    <g data-district-id={districtId}>
      {Array.from({ length: layout.columnCount }, (_, column) => {
        const machineX =
          x +
          layout.inputTransportWidth +
          layout.inputBeltGap +
          column * (machineWidth + layout.columnGap);
        return (
          <g key={`belts-${column}`}>
            {drawInputBelts &&
              Array.from({ length: layout.inputBeltsPerColumn }, (_, beltIndex) => (
                <rect
                  class="cell-radar-belt"
                  key={`in-${beltIndex}`}
                  x={machineX - layout.inputBeltGap - layout.inputPipesPerColumn - 1 - beltIndex}
                  y={inputBeltTop}
                  width={0.75}
                  height={y + layout.columnHeights[column]! - inputBeltTop}
                  data-bus-routes={inputBeltRoutes}
                  data-bus-segment="vertical-input"
                  data-bus-direction="off-bus"
                />
              ))}
            {drawInputBelts &&
              Array.from({ length: layout.inputPipesPerColumn }, (_, pipeIndex) => (
                <rect
                  class="cell-radar-pipe"
                  key={`in-pipe-${pipeIndex}`}
                  x={machineX - layout.inputBeltGap - 1 - pipeIndex}
                  y={inputPipeTop}
                  width={0.75}
                  height={y + layout.columnHeights[column]! - inputPipeTop}
                  data-bus-routes={inputPipeRoutes}
                  data-bus-segment="vertical-input"
                  data-bus-direction="off-bus"
                />
              ))}
            {Array.from({ length: layout.outputPipesPerColumn }, (_, pipeIndex) => (
              <rect
                class="cell-radar-pipe"
                key={`out-pipe-${pipeIndex}`}
                x={machineX + machineWidth + layout.outputBeltGap + pipeIndex}
                y={outputPipeTop}
                width={0.75}
                height={y + layout.columnHeights[column]! - outputPipeTop}
                data-bus-routes={outputPipeRoutes}
                data-bus-segment="vertical-output"
                data-bus-direction="onto-bus"
              />
            ))}
            {Array.from({ length: layout.outputBeltsPerColumn }, (_, beltIndex) => (
              <rect
                class="cell-radar-belt"
                key={`out-${beltIndex}`}
                x={
                  machineX +
                  machineWidth +
                  layout.outputBeltGap +
                  layout.outputPipesPerColumn +
                  beltIndex
                }
                y={outputBeltTop}
                width={0.75}
                height={y + layout.columnHeights[column]! - outputBeltTop}
                data-bus-routes={outputBeltRoutes}
                data-bus-segment="vertical-output"
                data-bus-direction="onto-bus"
              />
            ))}
          </g>
        );
      })}
      {layout.assemblers.map(({ column, row }, index) => (
        <rect
          class="cell-radar-assembler"
          key={index}
          x={
            x +
            layout.inputTransportWidth +
            layout.inputBeltGap +
            column * (machineWidth + layout.columnGap)
          }
          y={y + row * machineHeight}
          width={machineWidth}
          height={machineHeight}
        />
      ))}
      <RecipeIcon x={iconX} y={iconY} size={iconSize} recipe={recipe} name={recipeName} />
    </g>
  );
}

function RecipeIcon({
  x,
  y,
  size,
  recipe,
  name,
}: {
  x: number;
  y: number;
  size: number;
  recipe: string;
  name: string;
}) {
  const recipeData = staticData.recipes[recipe];
  const product = recipeData?.products[0]?.resource;
  const [url, spriteX, spriteY, sheetSize] = iconSprite(
    `recipe:${recipe}`,
    ...(product ? [product] : []),
    'recipe:recipe-unknown',
  );
  return (
    <svg
      class="cell-radar-recipe-icon"
      x={x}
      y={y}
      width={size}
      height={size}
      viewBox={`${spriteX} ${spriteY} 32 32`}
      role="img"
      aria-label={name}
    >
      <title>{name}</title>
      <image href={url} width={sheetSize} height={sheetSize} />
    </svg>
  );
}
