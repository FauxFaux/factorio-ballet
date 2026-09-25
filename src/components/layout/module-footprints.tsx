import type { FactoryModule } from '../../compute/modules.ts';
import type { ModuleConnection } from '../../compute/module-connections.ts';
import { staticData } from '../../data/decode.ts';
import { iconSprite } from '../icon.tsx';

/** A provisional left-to-right row in the layout's 192 by 128 tile space. */
export function ModuleFootprints({
  modules,
  connections = [],
}: {
  modules: FactoryModule[];
  connections?: ModuleConnection[];
}) {
  let nextX = 8;
  const placed = modules.map((module) => {
    const x = nextX;
    const labelWidth = `${module.machineCount}×`.length * 1.25 + 4;
    nextX += Math.max(module.size.width, labelWidth) + 4;
    return { module, x, y: 26 };
  });
  const byId = new Map(placed.map((placement) => [placement.module.id, placement]));
  const pairCounts = new Map<string, number>();
  return (
    <svg
      class="cell-layout-modules"
      viewBox="0 0 192 128"
      aria-label={`${modules.length} factory modules`}
    >
      {connections.map((connection) => {
        const producer = byId.get(connection.producerId);
        const consumer = byId.get(connection.consumerId);
        if (!producer || !consumer) return null;
        const rightward = producer.x < consumer.x;
        const startX = producer.x + (rightward ? producer.module.size.width : 0);
        const endX = consumer.x + (rightward ? 0 : consumer.module.size.width);
        const startY = producer.y + producer.module.size.height / 2;
        const endY = consumer.y + consumer.module.size.height / 2;
        const pair = `${connection.producerId}|${connection.consumerId}`;
        const index = pairCounts.get(pair) ?? 0;
        pairCounts.set(pair, index + 1);
        const bend = index === 0 ? 0 : Math.ceil(index / 2) * (index % 2 ? 3 : -3);
        const middleX = (startX + endX) / 2;
        return (
          <path
            key={`${pair}|${connection.resource}`}
            class={`cell-layout-module-connection${connection.resource.startsWith('fluid:') ? ' is-fluid' : ''}`}
            d={`M ${startX} ${startY} Q ${middleX} ${(startY + endY) / 2 + bend} ${endX} ${endY}`}
            data-layout-resource={connection.resource}
            data-layout-rate={connection.rate}
          >
            <title>{`${connection.resource}: ${connection.rate}/s from ${connection.producerId} to ${connection.consumerId}`}</title>
          </path>
        );
      })}
      {placed.map(({ module, x, y }) => {
        const product = staticData.recipes[module.recipe]?.products[0]?.resource;
        const [url, spriteX, spriteY, sheetSize] = iconSprite(
          `recipe:${module.recipe}`,
          ...(product ? [product] : []),
          'recipe:recipe-unknown',
        );
        const countLabel = `${module.machineCount}×`;
        return (
          <g key={module.id} data-layout-module={module.id}>
            <title>{`${module.recipe}: ${module.machineCount} machines, ${module.size.width}×${module.size.height} tiles`}</title>
            <rect
              class="cell-layout-module"
              x={x}
              y={y}
              width={module.size.width}
              height={module.size.height}
            />
            <text class="cell-layout-module-label" x={x + 0.4} y={y + 4}>
              {countLabel}
            </text>
            <svg
              class="cell-layout-module-icon"
              x={x + 0.7 + countLabel.length * 1.25}
              y={y + 1.1}
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
