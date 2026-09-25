import type { FactoryModule } from '../../compute/modules.ts';
import { staticData } from '../../data/decode.ts';
import { iconSprite } from '../icon.tsx';

/** A provisional left-to-right row in the layout's 192 by 128 tile space. */
export function ModuleFootprints({ modules }: { modules: FactoryModule[] }) {
  let nextX = 8;
  return (
    <svg
      class="cell-layout-modules"
      viewBox="0 0 192 128"
      aria-label={`${modules.length} factory modules`}
    >
      {modules.map((module) => {
        const x = nextX;
        const product = staticData.recipes[module.recipe]?.products[0]?.resource;
        const [url, spriteX, spriteY, sheetSize] = iconSprite(
          `recipe:${module.recipe}`,
          ...(product ? [product] : []),
          'recipe:recipe-unknown',
        );
        const countLabel = `${module.machineCount}×`;
        nextX += Math.max(module.size.width, countLabel.length * 1.25 + 4) + 4;
        return (
          <g key={module.id} data-layout-module={module.id}>
            <title>{`${module.recipe}: ${module.machineCount} machines, ${module.size.width}×${module.size.height} tiles`}</title>
            <rect
              class="cell-layout-module"
              x={x}
              y={26}
              width={module.size.width}
              height={module.size.height}
            />
            <text class="cell-layout-module-label" x={x + 0.4} y={30}>
              {countLabel}
            </text>
            <svg
              class="cell-layout-module-icon"
              x={x + 0.7 + countLabel.length * 1.25}
              y={27.1}
              width="3.3"
              height="3.3"
              viewBox={`${spriteX} ${spriteY} 32 32`}
              aria-hidden="true"
            >
              <image href={url} width={sheetSize} height={sheetSize} />
            </svg>
          </g>
        );
      })}
    </svg>
  );
}
