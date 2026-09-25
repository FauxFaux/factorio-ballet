import type { FactoryModule } from '../../compute/modules.ts';

/** A provisional left-to-right row in the layout's 192 by 128 tile space. */
export function ModuleFootprints({ modules }: { modules: FactoryModule[] }) {
  let nextX = 8;
  return (
    <svg
      class="cell-layout-modules"
      viewBox="0 0 192 128"
      aria-label={`${modules.length} factory modules`}
    >
      {modules.map((module, index) => {
        const x = nextX;
        nextX += module.size.width + 4;
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
            <text class="cell-layout-module-label" x={x + 1} y={24}>
              {index + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
