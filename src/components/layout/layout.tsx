import './layout.css';
import { useMemo } from 'preact/hooks';
import { buildRailBrick } from '../../bp/rail-blueprint.ts';
import { RailBlueprintPreview } from '../rail-blueprint-preview.tsx';
import type { CellLayout } from '../../layout.ts';
import type { ResourceId } from '../../types.ts';

/** The initial, intentionally empty surface for a cell's factory layout. */
export function CellLayoutSurface({
  layout: _layout,
  inputs,
  outputs,
}: {
  layout: CellLayout;
  inputs: ResourceId[];
  outputs: ResourceId[];
}) {
  const blueprint = useMemo(
    () => buildRailBrick(inputs.length, outputs.length),
    [inputs.length, outputs.length],
  );
  if (!('blueprint' in blueprint)) throw new Error('rail brick builder returned a book');

  return (
    <section class="cell-layout" aria-label="Layout">
      <RailBlueprintPreview blueprint={blueprint.blueprint} embedded />
    </section>
  );
}
