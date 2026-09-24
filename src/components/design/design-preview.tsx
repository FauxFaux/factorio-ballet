import './design-column.css';
import './design-preview.css';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { DesignColumn, DesignEntity } from '../../compute/design.ts';
import type { TileLaneAssignment } from '../../compute/design-validation/types.ts';
import { TILE_SIZE, type ViewportPoint } from './design-entities.tsx';
import { DesignScene } from './design-scene.tsx';
import type { DesignSceneItems, DesignSceneMachines, DesignSceneRecipes } from './design-scene.tsx';

const previewPadding = TILE_SIZE;
const maximumPreviewScale = 3;

interface DesignBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface PreviewCamera {
  origin: ViewportPoint;
  scale: number;
}

/** Return the complete tile bounds of the entities in a design column. */
export function designBounds(entities: DesignEntity[]): DesignBounds | undefined {
  if (entities.length === 0) return undefined;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const entity of entities) {
    const size = entity.kind === 'assembler' ? entity.size : { width: 1, height: 1 };
    minX = Math.min(minX, entity.position.x);
    maxX = Math.max(maxX, entity.position.x + size.width);
    minY = Math.min(minY, entity.position.y);
    maxY = Math.max(maxY, entity.position.y + size.height);
  }
  return { minX, maxX, minY, maxY };
}

/** Fit a design into a read-only viewport, expressed in the scene's unscaled pixel coordinates. */
export function fitDesignPreview(
  entities: DesignEntity[],
  viewportSize: ViewportPoint,
): PreviewCamera {
  const bounds = designBounds(entities);
  if (!bounds || viewportSize.x <= 0 || viewportSize.y <= 0) {
    return {
      origin: { x: viewportSize.x / 2, y: viewportSize.y / 2 },
      scale: 1,
    };
  }

  const width = Math.max((bounds.maxX - bounds.minX) * TILE_SIZE, TILE_SIZE);
  const height = Math.max((bounds.maxY - bounds.minY) * TILE_SIZE, TILE_SIZE);
  const availableWidth = Math.max(viewportSize.x - previewPadding * 2, 1);
  const availableHeight = Math.max(viewportSize.y - previewPadding * 2, 1);
  const scale = Math.min(maximumPreviewScale, availableWidth / width, availableHeight / height);
  const centreX = ((bounds.minX + bounds.maxX) / 2) * TILE_SIZE;
  const centreY = ((bounds.minY + bounds.maxY) / 2) * TILE_SIZE;

  return {
    origin: {
      x: viewportSize.x / scale / 2 - centreX,
      y: viewportSize.y / scale / 2 - centreY,
    },
    scale,
  };
}

/** A fitted, read-only rendering of a design column. */
export function DesignPreview({
  column,
  lanes,
  label,
  recipes,
  machinesByRecipe,
  items,
}: {
  column: DesignColumn;
  lanes?: TileLaneAssignment[];
  label: string;
  recipes: DesignSceneRecipes;
  machinesByRecipe?: DesignSceneMachines;
  items?: DesignSceneItems;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState<ViewportPoint>({ x: 0, y: 0 });

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;

    const measure = () => {
      const { width: x, height: y } = element.getBoundingClientRect();
      setViewportSize((previous) => (previous.x === x && previous.y === y ? previous : { x, y }));
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { origin, scale } = fitDesignPreview(column.entities, viewportSize);

  return (
    <div
      ref={viewport}
      class="design-preview"
      role="region"
      aria-label={label}
      data-entity-count={column.entities.length}
      style={{ '--cell-design-tile-size': `${TILE_SIZE}px` }}
    >
      <div
        class="design-preview-world"
        style={{
          width: `${viewportSize.x / scale}px`,
          height: `${viewportSize.y / scale}px`,
          backgroundPosition: `${origin.x}px ${origin.y}px`,
          transform: `scale(${scale})`,
        }}
      >
        <DesignScene
          column={column}
          assignedLanes={lanes}
          worldOrigin={origin}
          recipes={recipes}
          machinesByRecipe={machinesByRecipe}
          items={items}
        />
      </div>
    </div>
  );
}
