import './radar.css';
import { entryMachine, entryRecipe, type CellEntry } from '../../cell.ts';
import { resourceName, staticData } from '../../data/index.ts';
import { icons } from '../../data/decode-icons.ts';
import type { ResourceId } from '../../types.ts';
import { assemblerColumnLayout } from './radar-layout.ts';

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
  return (
    <figure class="cell-radar">
      <figcaption>
        <span>Rail brick</span>
        <span class="cell-radar-caption">{title}</span>
      </figcaption>
      <svg
        viewBox="0 0 192 128"
        role="img"
        aria-label={`Rail brick for ${title}: ${inputs.length} input and ${outputs.length} output stations`}
      >
        <title>Rail brick for {title}</title>
        <desc>
          A cell-sized rail brick. Each input has a station on the left and each output has a
          station on the right.
        </desc>
        <rect class="cell-radar-floor" x="0" y="0" width="192" height="128" />
        <RailBorder />
        <path class="cell-radar-path" d={railPath(inputs.length, outputs.length)} />
        <StationStops side="in" resources={inputs} />
        <StationStops side="out" resources={outputs} />
        <AssemblerColumns
          entries={entries}
          counts={counts}
          progress={progress}
          startX={8 + inputs.length * 8}
        />
      </svg>
    </figure>
  );
}

/**
 * Each recipe is its own district for now. Assemblers fill 100 units of the radar's usable
 * vertical space, then continue in a new column so they remain inside the rail brick.
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
  const columns = entries
    .map((entry, index) => ({ entry, count: counts[index], index }))
    .toReversed()
    .flatMap(({ entry, count: solvedCount, index }) => {
      const recipe = entryRecipe(entry);
      if (!recipe) return [];

      const machineId = entryMachine(entry, recipe, progress);
      const machine = machineId ? staticData.machines[machineId] : undefined;
      if (!machine) return [];

      const count = Math.max(1, Math.ceil(solvedCount ?? 1));
      const column = (
        <AssemblerColumn
          key={`${entry.recipe}-${index}`}
          x={x}
          recipe={entry.recipe}
          recipeName={recipe.human ?? entry.recipe}
          machineWidth={machine.size.width}
          machineHeight={machine.size.height}
          count={count}
        />
      );
      x += assemblerColumnLayout(machine.size.width, machine.size.height, count).width + 4;
      return [column];
    });

  return <g class="cell-radar-assemblers">{columns}</g>;
}

function AssemblerColumn({
  x,
  recipe,
  recipeName,
  machineWidth,
  machineHeight,
  count,
}: {
  x: number;
  recipe: string;
  recipeName: string;
  machineWidth: number;
  machineHeight: number;
  count: number;
}) {
  const layout = assemblerColumnLayout(machineWidth, machineHeight, count);
  const iconSize = 12;
  const iconX = x + layout.width / 2 - iconSize / 2;
  const iconY = 20 + layout.height / 2 - iconSize / 2;

  return (
    <g>
      {layout.assemblers.map(({ column, row }, index) => (
        <rect
          class="cell-radar-assembler"
          key={index}
          x={x + column * (machineWidth + 4)}
          y={20 + row * machineHeight}
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
  const [url, spriteX, spriteY, sheetSize] =
    icons[`recipe:${recipe}`] ??
    (product ? icons[product] : undefined) ??
    icons['recipe:recipe-unknown'];

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
  ) =>
    `c ${startControlX} ${startControlY}, ${endControlX + endX} ${endControlY + endY}, ${endX} ${endY}`;

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

function StationStops({ side, resources }: { side: 'in' | 'out'; resources: ResourceId[] }) {
  return (
    <g class="cell-radar-stops">
      {resources.map((resource, index) => {
        const offset = 8 * (index + 1);
        const input = side === 'in';
        const x = input ? 4 + offset - 2 : 188 - offset + 2;
        const y = input ? 84 : 38;
        return (
          <circle key={resource} cx={x} cy={y} r="1.8">
            <title>{resourceName(resource)}</title>
          </circle>
        );
      })}
    </g>
  );
}
