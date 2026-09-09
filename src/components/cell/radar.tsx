import './radar.css';
import { entryMachine, entryRecipe, type CellEntry } from '../../cell.ts';
import { resourceName } from '../../data/index.ts';
import { staticData } from '../../data/decode.ts';
import type { ResourceId } from '../../types.ts';
import { iconSprite } from '../icon.tsx';
import { assemblerColumnLayout, stackAssemblerDistricts } from './radar-layout.ts';

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
  counts,
  progress,
}: {
  title: string;
  inputs: ResourceId[];
  outputs: ResourceId[];
  entries: CellEntry[];
  counts: (number | undefined)[];
  progress: number;
}) {
  const stationSummary = `${inputs.length} input and ${outputs.length} output stations`;
  return (
    <figure class="cell-radar">
      <figcaption>
        <span>Rail brick</span>
        <span class="cell-radar-caption">{title}</span>
      </figcaption>
      <svg
        viewBox="0 0 192 128"
        role="img"
        aria-label={`Rail brick for ${title}: ${stationSummary}`}
      >
        <title>Rail brick for {title}</title>
        <desc>
          A cell-sized rail brick. Each input has a station on the left and each output has a
          station on the right.
        </desc>
        <rect class="cell-radar-floor" x="0" y="0" width="192" height="128" />
        <RailBorder />
        <path class="cell-radar-path" d={stackedRailPath(inputs.length, outputs.length)} />
        <StationStops side="in" resources={inputs} stacked />
        <StationStops side="out" resources={outputs} />
        <AssemblerColumns entries={entries} counts={counts} progress={progress} startX={68} />
      </svg>
    </figure>
  );
}

/**
 * A private hand-off lets two neighbouring recipe districts share a vertical assembler column.
 * Other hand-offs keep their own column so the sketch does not pretend their routing is simpler
 * than it is.
 */
function AssemblerColumns({
  entries,
  counts,
  progress,
  startX,
}: {
  entries: CellEntry[];
  counts: (number | undefined)[];
  progress: number;
  startX: number;
}) {
  let x = startX;
  const districts = entries
    .map((entry, index) => ({ entry, count: counts[index], index }))
    .toReversed()
    .flatMap(({ entry, count: solvedCount, index }) => {
      const recipe = entryRecipe(entry);
      if (!recipe) return [];

      const machineId = entryMachine(entry, recipe, progress);
      const machine = machineId ? staticData.machines[machineId] : undefined;
      if (!machine) return [];

      const count = Math.max(1, Math.ceil(solvedCount ?? 1));
      return [
        {
          id: `${entry.recipe}-${index}`,
          recipeId: entry.recipe,
          recipeName: recipe.human ?? entry.recipe,
          recipe,
          machineWidth: machine.size.width,
          machineHeight: machine.size.height,
          count,
        },
      ];
    });

  const columns = stackAssemblerDistricts(districts).map((stack, stackIndex) => {
    const column = (
      <g key={stackIndex}>
        {stack.districts.map(
          ({ id, recipeId, recipeName, machineWidth, machineHeight, count, y }) => (
            <AssemblerColumn
              key={id}
              x={x}
              y={20 + y}
              recipe={recipeId}
              recipeName={recipeName}
              machineWidth={machineWidth}
              machineHeight={machineHeight}
              count={count}
            />
          ),
        )}
      </g>
    );
    x += stack.width + 4;
    return column;
  });

  return <g class="cell-radar-assemblers">{columns}</g>;
}

function AssemblerColumn({
  x,
  y,
  recipe,
  recipeName,
  machineWidth,
  machineHeight,
  count,
}: {
  x: number;
  y: number;
  recipe: string;
  recipeName: string;
  machineWidth: number;
  machineHeight: number;
  count: number;
}) {
  const layout = assemblerColumnLayout(machineWidth, machineHeight, count);
  const iconSize = 12;
  const iconX = x + layout.width / 2 - iconSize / 2;
  const iconY = y + layout.height / 2 - iconSize / 2;

  return (
    <g>
      {layout.assemblers.map(({ column, row }, index) => (
        <rect
          class="cell-radar-assembler"
          key={index}
          x={x + column * (machineWidth + 4)}
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
        const offset = 8 * (index + 1);
        const input = side === 'in';
        const stackedStop = input && stacked ? stackedInputStationStop(index) : undefined;
        const x = stackedStop?.x ?? (input ? 4 + offset - 2 : 188 - offset + 2);
        const y = stackedStop?.y ?? (input ? 84 : 38);
        return (
          <circle key={resource} cx={x} cy={y} r="1.8">
            <title>{resourceName(resource)}</title>
          </circle>
        );
      })}
    </g>
  );
}
