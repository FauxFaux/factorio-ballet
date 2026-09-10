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
const stationBeltBottomY = 64;
const transportLaneWidth = 0.75;
const stationLanePitch = 1;
const stationBusOffset = 2;

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
    const lastInputColumnOffset = singleDistrict
      ? (singleDistrict.layout.columnCount - 1) *
        (singleDistrict.layout.machineWidth + singleDistrict.layout.columnGap)
      : 0;
    const positioned = {
      stack,
      x,
      centerX: x + stack.width / 2,
      inputBeltX: inputTransportArrivalX(x + lastInputColumnOffset, inputBelts),
      inputPipeX: inputTransportArrivalX(x + lastInputColumnOffset, inputBelts + inputPipes),
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
  const inputStations = new Map(
    inputs.map((resource, index) => [resource, stationStop('in', index, stackedStations)]),
  );
  const outputStations = new Map(
    outputs.map((resource, index) => [resource, stationStop('out', index)]),
  );
  const routeLaneCounts = new Map(bus.routes.map(({ id, laneCount }) => [id, laneCount]));
  const routeLaneRanks = routeLaneRanksFromTop(bus.lanes);
  return (
    <g class="cell-radar-assemblers">
      <g class="cell-radar-bus">
        {bus.lanes.map(({ id, routeId, resource, transport, routeLane, lane, start, end }) => {
          const routeLaneRank = routeLaneRanks.get(id) ?? routeLane;
          const startColumn = busColumns[start - 1];
          const positionedStart = positionedStacks[start - 1];
          const startLaneRank = startColumn
            ? connectionLaneRanksFromTop(bus.lanes, startColumn.outputs, transport).get(id)
            : undefined;
          const inputStation = start === 0 ? inputStations.get(resource) : undefined;
          const inputStationLaneX = inputStation
            ? stationLaneX(
                inputStation.x - stationBusOffset,
                // Input stations approach the bus from the left, so their lane bank mirrors the
                // bus: the leftmost vertical belt must meet the topmost horizontal lane.
                routeLaneRank,
                routeLaneCounts.get(routeId) ?? 1,
              )
            : undefined;
          const startX =
            start === 0
              ? inputStationLaneX === undefined
                ? busX[start]!
                : inputStationLaneX - transportLaneWidth / 2
              : startColumn?.outputs.some((flow) => flow.resource === resource) && positionedStart
                ? outputTransportDepartureX(
                    positionedStart.x,
                    positionedStart.stack,
                    resource,
                    transport,
                    startLaneRank ?? routeLaneRank,
                  )
                : busX[start]!;
          const endColumn = busColumns[end - 1];
          const positionedEnd = positionedStacks[end - 1];
          const endLaneRank = endColumn
            ? connectionLaneRanksFromTop(bus.lanes, endColumn.inputs, transport).get(id)
            : undefined;
          const outputStation =
            end === busColumns.length + 1 ? outputStations.get(resource) : undefined;
          const outputStationLaneX = outputStation
            ? stationLaneX(
                outputStation.x + stationBusOffset,
                (routeLaneCounts.get(routeId) ?? 1) - routeLaneRank - 1,
                routeLaneCounts.get(routeId) ?? 1,
              )
            : undefined;
          const endX =
            end === busColumns.length + 1
              ? outputStationLaneX === undefined
                ? busX[end]!
                : outputStationLaneX + transportLaneWidth / 2
              : endColumn?.inputs.some((flow) => flow.resource === resource) && positionedEnd
                ? transport === 'belt'
                  ? positionedEnd.inputBeltX - (endLaneRank ?? routeLaneRank)
                  : positionedEnd.inputPipeX
                : busX[end]!;
          return (
            <g key={id}>
              <rect
                class={transport === 'belt' ? 'cell-radar-belt' : 'cell-radar-pipe'}
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
              {inputStation ? (
                <StationConnection
                  x={inputStationLaneX!}
                  bottomY={stationBeltBottomY}
                  routeId={routeId}
                  resource={resource}
                  transport={transport}
                  lane={lane}
                  direction="onto-bus"
                />
              ) : null}
              {outputStation ? (
                <StationConnection
                  x={outputStationLaneX!}
                  bottomY={stationBeltBottomY}
                  routeId={routeId}
                  resource={resource}
                  transport={transport}
                  lane={lane}
                  direction="off-bus"
                />
              ) : null}
            </g>
          );
        })}
      </g>
      {positionedStacks.map(({ stack, x }, stackIndex) => {
        const stackInputFlows = stack.districts.flatMap(({ inputFlows }) => inputFlows);
        const inputBeltTop = connectionTopY(bus.lanes, stackInputFlows, 'belt');
        const inputBeltTops = connectionLaneTops(bus.lanes, stackInputFlows, 'belt');
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
                y={inputBeltTops.at(-beltIndex - 1) ?? inputBeltTop}
                width={0.75}
                height={
                  assemblerTopY + stack.height - (inputBeltTops.at(-beltIndex - 1) ?? inputBeltTop)
                }
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
                  inputBeltTops={connectionLaneTops(bus.lanes, inputFlows, 'belt')}
                  inputPipeTop={connectionTopY(bus.lanes, inputFlows, 'pipe')}
                  outputBeltTop={connectionTopY(bus.lanes, outputFlows, 'belt')}
                  outputBeltTops={connectionLaneTops(bus.lanes, outputFlows, 'belt')}
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

/** One computed physical lane from a rail station to its matching horizontal bus lane. */
function StationConnection({
  x,
  bottomY,
  routeId,
  resource,
  transport,
  lane,
  direction,
}: {
  x: number;
  bottomY: number;
  routeId: string;
  resource: ResourceId;
  transport: BusLane['transport'];
  lane: number;
  direction: 'onto-bus' | 'off-bus';
}) {
  const topY = busBottomY - lane;
  return (
    <rect
      class={transport === 'belt' ? 'cell-radar-belt' : 'cell-radar-pipe'}
      data-bus-route={routeId}
      data-resource={resource}
      data-bus-segment="station-belt"
      data-bus-direction={direction}
      x={x - transportLaneWidth / 2}
      y={topY}
      width={transportLaneWidth}
      height={bottomY - topY}
    />
  );
}

/** Keep each physical lane distinguishable as it leaves a shared station. */
function stationLaneX(stationX: number, routeLane: number, laneCount: number): number {
  return stationX + (routeLane - (laneCount - 1) / 2) * stationLanePitch;
}

function inputTransportArrivalX(stackX: number, lanesThroughBank: number) {
  return lanesThroughBank === 0 ? stackX : stackX + lanesThroughBank - 1 + transportLaneWidth / 2;
}
function outputTransportDepartureX(
  stackX: number,
  stack: AssemblerStack,
  resource: ResourceId,
  transport: BusLane['transport'],
  routeLane: number,
) {
  return Math.min(
    ...stack.districts.flatMap(({ layout, outputFlows }) =>
      outputFlows.some((flow) => flow.resource === resource)
        ? [
            stackX +
              layout.inputTransportWidth +
              layout.inputBeltGap +
              layout.machineWidth +
              layout.outputBeltGap +
              (transport === 'belt' ? layout.outputPipesPerColumn : 0) +
              transportLaneWidth / 2 +
              routeLane,
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

/** Physical bus lanes may be sparse, so retain their actual vertical positions. */
function connectionLaneTops(
  busLanes: BusLane[],
  flows: { resource: ResourceId }[],
  transport: BusLane['transport'],
) {
  return connectionLanesFromTop(busLanes, flows, transport).map((lane) => busBottomY - lane.lane);
}

/** A connection bank's physical lanes, ordered from its topmost belt to its bottommost. */
function connectionLanesFromTop(
  busLanes: BusLane[],
  flows: { resource: ResourceId }[],
  transport: BusLane['transport'],
) {
  const resources = new Set(flows.map(({ resource }) => resource));
  return busLanes
    .filter((lane) => lane.transport === transport && resources.has(lane.resource))
    .sort((a, b) => b.lane - a.lane);
}

/** Index a physical bus lane within the belt bank it connects to. */
function connectionLaneRanksFromTop(
  busLanes: BusLane[],
  flows: { resource: ResourceId }[],
  transport: BusLane['transport'],
) {
  return new Map(
    connectionLanesFromTop(busLanes, flows, transport).map((lane, index) => [lane.id, index]),
  );
}

/** Rank a route's physical lanes from top to bottom, even when other lanes leave gaps. */
function routeLaneRanksFromTop(busLanes: BusLane[]) {
  const ranks = new Map<string, number>();
  const byRoute = new Map<string, BusLane[]>();
  for (const lane of busLanes) {
    const lanes = byRoute.get(lane.routeId) ?? [];
    lanes.push(lane);
    byRoute.set(lane.routeId, lanes);
  }
  for (const lanes of byRoute.values()) {
    lanes.sort((a, b) => b.lane - a.lane).forEach((lane, rank) => ranks.set(lane.id, rank));
  }
  return ranks;
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
  inputBeltTops,
  inputPipeTop,
  outputBeltTop,
  outputBeltTops,
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
  inputBeltTops: number[];
  inputPipeTop: number;
  outputBeltTop: number;
  outputBeltTops: number[];
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
          column * (layout.machineWidth + layout.columnGap);
        return (
          <g key={`belts-${column}`}>
            {drawInputBelts &&
              Array.from({ length: layout.inputBeltsPerColumn }, (_, beltIndex) => (
                <rect
                  class="cell-radar-belt"
                  key={`in-${beltIndex}`}
                  x={machineX - layout.inputBeltGap - layout.inputPipesPerColumn - 1 - beltIndex}
                  y={inputBeltTops[beltIndex] ?? inputBeltTop}
                  width={0.75}
                  height={
                    y + layout.columnHeights[column]! - (inputBeltTops[beltIndex] ?? inputBeltTop)
                  }
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
                x={machineX + layout.machineWidth + layout.outputBeltGap + pipeIndex}
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
                  layout.machineWidth +
                  layout.outputBeltGap +
                  layout.outputPipesPerColumn +
                  beltIndex
                }
                y={outputBeltTops[beltIndex] ?? outputBeltTop}
                width={0.75}
                height={
                  y + layout.columnHeights[column]! - (outputBeltTops[beltIndex] ?? outputBeltTop)
                }
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
            column * (layout.machineWidth + layout.columnGap)
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
