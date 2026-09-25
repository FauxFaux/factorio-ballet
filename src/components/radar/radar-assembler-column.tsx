import { useDataset } from '../../dataset/context.tsx';
import { iconSprite } from '../icon.tsx';
import { assemblerColumnLayout } from './radar-assembler-layout.ts';

function bankLaneTop(
  laneTops: number[],
  column: number,
  columnCount: number,
  beltsPerColumn: number,
  beltIndex: number,
) {
  const lastStart = Math.max(0, laneTops.length - beltsPerColumn);
  const start = columnCount <= 1 ? 0 : Math.round((column * lastStart) / (columnCount - 1));
  return laneTops[start + beltIndex];
}

function OutputBelt({
  x,
  topY,
  bottomY,
  routes,
}: {
  x: number;
  topY: number;
  bottomY: number;
  routes: string;
}) {
  return (
    <rect
      class="cell-radar-belt"
      x={x}
      y={topY}
      width={0.75}
      height={bottomY - topY}
      data-bus-routes={routes}
      data-bus-segment="vertical-output"
      data-bus-direction="onto-bus"
    />
  );
}

/** Draw one recipe district's assemblers and their vertical bus connections. */
export function RadarAssemblerColumn({
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
              <OutputBelt
                key={`out-${beltIndex}`}
                x={
                  machineX +
                  layout.machineWidth +
                  layout.outputBeltGap +
                  layout.outputPipesPerColumn +
                  beltIndex
                }
                topY={
                  bankLaneTop(
                    outputBeltTops,
                    column,
                    layout.columnCount,
                    layout.outputBeltsPerColumn,
                    beltIndex,
                  ) ?? outputBeltTop
                }
                bottomY={y + layout.columnHeights[column]!}
                routes={outputBeltRoutes}
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
  const { data, iconMap } = useDataset();
  const recipeData = data.recipes[recipe];
  const product = recipeData?.products[0]?.resource;
  const [url, spriteX, spriteY, sheetWidth, sheetHeight] = iconSprite(
    iconMap,
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
      <image href={url} width={sheetWidth} height={sheetHeight} />
    </svg>
  );
}
