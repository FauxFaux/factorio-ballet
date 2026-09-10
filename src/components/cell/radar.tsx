import './radar.css';
import { entryMachine, entryRecipe, type CellEntry } from '../../cell.ts';
import { resourceName } from '../../data/index.ts';
import { staticData } from '../../data/decode.ts';
import type { Solution } from '../../solve/index.ts';
import type { Belt, ResourceId } from '../../types.ts';
import type { RefObject } from 'preact';
import { iconSprite } from '../icon.tsx';
import { itemRateTotal, recipeConnections } from './connection-calc.ts';
import {
  assemblerColumnLayout,
  busConnectionTopLane,
  busLaneLayout,
  stackAssemblerDistricts,
  type AssemblerStack,
  type BusLane,
} from './radar-layout.ts';

const assemblerTopY = 20;
const busBottomY = assemblerTopY - 1;
const transportLaneWidth = 0.75;

/**
 * RADAR's rail view adapted to one cell, which is one brick for now. Its 192-by-128 coordinates
 * are deliberately schematic; `docs/blueprints/RAIL.md` is the source for the future blueprint
 * geometry. The grid and every station siding are deliberately one SVG path, as in RADAR.
 */
export function CellRadar({
  title,
  inputs,
  outputs,
  entries,
  solution,
  belt,
  progress,
  onExpand,
  expandButtonRef,
}: {
  title: string;
  inputs: ResourceId[];
  outputs: ResourceId[];
  entries: CellEntry[];
  solution: Solution;
  belt: Belt;
  progress: number;
  /** Makes the compact overview open its larger, cell-owned view. */
  onExpand?: () => void;
  expandButtonRef?: RefObject<HTMLButtonElement>;
}) {
  const stationSummary = `${inputs.length} input and ${outputs.length} output stations`;
  const stacked = inputs.length + outputs.length > 4;
  const assemblerStartX = stacked ? 68 : 8 + inputs.length * 8;
  return (
    <figure class="cell-radar">
      <figcaption>
        <span>Rail brick</span>
        <span class="cell-radar-caption">{title}</span>
      </figcaption>
      {onExpand ? (
        <button
          ref={expandButtonRef}
          type="button"
          class="cell-radar-expand"
          aria-label={`Expand rail brick for ${title}`}
          aria-haspopup="dialog"
          onClick={onExpand}
        >
          <RadarGraphic
            title={title}
            stationSummary={stationSummary}
            inputs={inputs}
            outputs={outputs}
            entries={entries}
            solution={solution}
            belt={belt}
            progress={progress}
            assemblerStartX={assemblerStartX}
            stacked={stacked}
            decorative
          />
        </button>
      ) : (
        <RadarGraphic
          title={title}
          stationSummary={stationSummary}
          inputs={inputs}
          outputs={outputs}
          entries={entries}
          solution={solution}
          belt={belt}
          progress={progress}
          assemblerStartX={assemblerStartX}
          stacked={stacked}
        />
      )}
    </figure>
  );
}

function RadarGraphic({
  title,
  stationSummary,
  inputs,
  outputs,
  entries,
  solution,
  belt,
  progress,
  assemblerStartX,
  stacked,
  decorative = false,
}: {
  title: string;
  stationSummary: string;
  inputs: ResourceId[];
  outputs: ResourceId[];
  entries: CellEntry[];
  solution: Solution;
  belt: Belt;
  progress: number;
  assemblerStartX: number;
  stacked: boolean;
  decorative?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 192 128"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : `Rail brick for ${title}: ${stationSummary}`}
    >
      <title>Rail brick for {title}</title>
      <desc>
        A cell-sized rail brick. Each input has a station on the left and each output has a station
        on the right.
      </desc>
      <rect class="cell-radar-floor" x="0" y="0" width="192" height="128" />
      <RailBorder />
      <path
        class="cell-radar-path"
        d={
          stacked
            ? stackedRailPath(inputs.length, outputs.length)
            : railPath(inputs.length, outputs.length)
        }
      />
      <StationStops side="in" resources={inputs} stacked={stacked} />
      <StationStops side="out" resources={outputs} />
      <AssemblerColumns
        inputs={inputs}
        outputs={outputs}
        entries={entries}
        solution={solution}
        belt={belt}
        progress={progress}
        startX={assemblerStartX}
        stackedStations={stacked}
      />
    </svg>
  );
}

/**
 * A private hand-off lets two neighbouring recipe districts share a vertical assembler column.
 * Other hand-offs keep their own column so the sketch does not pretend their routing is simpler
 * than it is.
 */
function AssemblerColumns({
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

      const count = Math.max(1, Math.ceil(solvedCount ?? 1));
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
          count,
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
    inputs: stack.districts.flatMap(({ inputFlows }) => inputFlows),
    outputs: stack.districts.flatMap(({ outputFlows }) => outputFlows),
  }));
  const busLanes = busLaneLayout(busColumns, inputs, outputs, belt.itemsPerSecond);
  const busX = [8, ...positionedStacks.map(({ centerX }) => centerX), 184];
  const inputStationX = new Map(
    inputs.map((resource, index) => [resource, stationStop('in', index, stackedStations).x]),
  );
  const outputStationX = new Map(
    outputs.map((resource, index) => [resource, stationStop('out', index).x]),
  );
  const columns = positionedStacks.map(({ stack, x }, stackIndex) => {
    const stackInputFlows = stack.districts.flatMap(({ inputFlows }) => inputFlows);
    const inputBeltTop = connectionTopY(busLanes, stackInputFlows, 'belt');
    const inputPipeTop = connectionTopY(busLanes, stackInputFlows, 'pipe');
    const column = (
      <g key={stackIndex}>
        {Array.from({ length: stack.externalInputBelts }, (_, beltIndex) => (
          <rect
            class="cell-radar-belt"
            key={`stack-in-${beltIndex}`}
            x={x + beltIndex}
            y={inputBeltTop}
            width={0.75}
            height={assemblerTopY + stack.height - inputBeltTop}
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
              inputBeltTop={connectionTopY(busLanes, inputFlows, 'belt')}
              inputPipeTop={connectionTopY(busLanes, inputFlows, 'pipe')}
              outputBeltTop={connectionTopY(busLanes, outputFlows, 'belt')}
              outputPipeTop={connectionTopY(busLanes, outputFlows, 'pipe')}
              drawInputBelts={stack.districts.length === 1}
            />
          ),
        )}
      </g>
    );
    return column;
  });

  return (
    <g class="cell-radar-assemblers">
      <g class="cell-radar-bus">
        {busLanes.map(({ resource, transport, lane, start, end }, index) => {
          const startColumn = busColumns[start - 1];
          const startsAtOutput = startColumn?.outputs.some((flow) => flow.resource === resource);
          const positionedStart = positionedStacks[start - 1];
          const startX =
            start === 0
              ? (inputStationX.get(resource) ?? busX[start]!)
              : startsAtOutput && positionedStart
                ? outputTransportDepartureX(
                    positionedStart.x,
                    positionedStart.stack,
                    resource,
                    transport,
                  )
                : busX[start]!;
          const endColumn = busColumns[end - 1];
          const endsAtInput = endColumn?.inputs.some((flow) => flow.resource === resource);
          const positionedEnd = positionedStacks[end - 1];
          const endX =
            end === busColumns.length + 1
              ? (outputStationX.get(resource) ?? busX[end]!)
              : endsAtInput && positionedEnd
                ? transport === 'belt'
                  ? positionedEnd.inputBeltX
                  : positionedEnd.inputPipeX
                : busX[end]!;
          return (
            <rect
              class={transport === 'belt' ? 'cell-radar-belt' : 'cell-radar-pipe'}
              key={`${resource}-${index}`}
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
      {columns}
    </g>
  );
}

/** Horizontal transport stops at the centre of the bank's assembler-side lane. */
function inputTransportArrivalX(stackX: number, lanesThroughBank: number): number {
  if (lanesThroughBank === 0) return stackX;
  return stackX + lanesThroughBank - 1 + transportLaneWidth / 2;
}

/** Start at the first matching output bank so the bus intersects every later repeated bank. */
function outputTransportDepartureX(
  stackX: number,
  stack: AssemblerStack,
  resource: ResourceId,
  transport: BusLane['transport'],
): number {
  const departures = stack.districts.flatMap(({ machineWidth, layout, outputFlows }) =>
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
  );
  return Math.min(...departures);
}

function connectionTopY(
  busLanes: BusLane[],
  flows: { resource: ResourceId }[],
  transport: BusLane['transport'],
): number {
  const lane = busConnectionTopLane(busLanes, flows, transport);
  return lane === undefined ? assemblerTopY : busBottomY - lane;
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
  drawInputBelts?: boolean;
}) {
  const iconSize = 12;
  const iconX = x + layout.width / 2 - iconSize / 2;
  const iconY = y + layout.height / 2 - iconSize / 2;

  return (
    <g>
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

/** An SVG view box crops the sprite sheet in the radar's own coordinate system. */
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

/** The four straight outer tracks from RADAR's grid. The remaining rails are in `railPath`. */
function RailBorder() {
  return (
    <g class="cell-radar-border">
      <rect x="3" y="4" width="2" height="120" />
      <rect x="187" y="4" width="2" height="120" />
      <rect x="0" y="4" width="192" height="2" />
      <rect x="0" y="122" width="192" height="2" />
    </g>
  );
}

/**
 * The original RADAR station allocator's geometry. Input sidings peel right from the left edge;
 * output sidings are its mirror. Keeping every segment in one path makes the rail shape a single
 * renderable object when we later swap its approximate coordinates for blueprint-derived ones.
 */
function railPath(inputCount: number, outputCount: number): string {
  const cubic = (
    [startControlX, startControlY]: [number, number],
    [endControlX, endControlY]: [number, number],
    [endX, endY]: [number, number],
  ) => {
    const endControl = `${endControlX + endX} ${endControlY + endY}`;
    return `c ${startControlX} ${startControlY}, ${endControl}, ${endX} ${endY}`;
  };

  const rails = [
    'M 4 13 a 8 8 0 0 1 8 -8',
    'M 4 115 a 8 8 0 0 0 8 8',
    'M 188 13 a 8 8 0 0 0 -8 -8',
    'M 188 115 a 8 8 0 0 1 -8 8',
    'M 4 4 a 8 8 0 0 0 -8 -8',
    'M 188 4 a 8 8 0 0 1 8 -8',
    'M 4 124 a 8 8 0 0 1 -8 8',
    'M 188 124 a 8 8 0 0 0 8 8',
  ];

  for (let index = 0; index < inputCount; index++) {
    const offset = 8 * (index + 1);
    const curve = 8 + index;
    rails.push(
      'M 4 13',
      cubic([0, curve], [0, -curve], [offset, 20]),
      'l 0 60',
      cubic([0, curve], [0, -curve], [-offset, 20]),
    );
  }

  for (let index = 0; index < outputCount; index++) {
    const offset = -8 * (index + 1);
    const curve = 8 + index;
    rails.push(
      'M 188 13',
      cubic([0, curve], [0, -curve], [offset, 20]),
      'l 0 60',
      cubic([0, curve], [0, -curve], [-offset, 20]),
    );
  }

  return rails.join(' ');
}

const stackedStationBottomY = 112;
const stackedStationPitch = 10;

/**
 * A dense input-station fan based on the stacked in-game rail layout. The two shared trunks use a
 * fixed amount of horizontal space; station S-curves are then added from the bottom upwards. Output
 * stations deliberately retain the original RADAR loops while this input layout is the default.
 */
export function stackedRailPath(inputCount: number, outputCount: number): string {
  const rails = [railPath(0, outputCount)];

  if (inputCount > 0) {
    const topStationY = stackedStationBottomY - (inputCount - 1) * stackedStationPitch;
    const rightTrunkTopY = topStationY + 8;
    rails.push('M 4 13 c 0 6, 4 7, 4 11 l 0 80');
    if (inputCount > 1) {
      rails.push(
        `M 60 ${rightTrunkTopY} l 0 ${stackedStationBottomY - rightTrunkTopY} c 0 7, 8 11, 16 11`,
      );
    }
  }

  for (let index = 0; index < inputCount; index++) {
    const y = stackedStationBottomY - index * stackedStationPitch;
    rails.push(
      `M 8 ${y - 8}`,
      'c 0 4, 4 8, 8 8',
      'l 36 0',
      index === 0 ? 'c 8 0, 8 11, 24 11' : 'c 4 0, 8 4, 8 8',
    );
  }

  return rails.join(' ');
}

export function stackedInputStationStop(index: number): { x: number; y: number } {
  return { x: 48, y: stackedStationBottomY - index * stackedStationPitch };
}

export function stationStop(
  side: 'in' | 'out',
  index: number,
  stacked = false,
): { x: number; y: number } {
  if (side === 'in' && stacked) return stackedInputStationStop(index);
  const offset = 8 * (index + 1);
  return {
    x: side === 'in' ? 4 + offset - 2 : 188 - offset + 2,
    y: side === 'in' ? 84 : 38,
  };
}

function StationStops({
  side,
  resources,
  stacked = false,
}: {
  side: 'in' | 'out';
  resources: ResourceId[];
  stacked?: boolean;
}) {
  return (
    <g class="cell-radar-stops">
      {resources.map((resource, index) => {
        const { x, y } = stationStop(side, index, stacked);
        return (
          <circle key={resource} cx={x} cy={y} r="1.8">
            <title>{resourceName(resource)}</title>
          </circle>
        );
      })}
    </g>
  );
}
