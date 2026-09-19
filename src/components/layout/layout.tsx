import './layout.css';
import { useMemo } from 'preact/hooks';
import { buildRailBrick } from '../../bp/rail-blueprint.ts';
import { RailBlueprintPreview } from '../rail-blueprint-preview.tsx';
import type { CellLayout } from '../../layout.ts';
import type { ResourceId } from '../../types.ts';
import { stackedRailStations } from '../cell/rail-mode.ts';

/** The initial, intentionally empty surface for a cell's factory layout. */
export function CellLayoutSurface({
  layout: _layout,
  inputs,
  outputs,
  stackedStations = stackedRailStations(inputs.length, outputs.length),
}: {
  layout: CellLayout;
  inputs: ResourceId[];
  outputs: ResourceId[];
  /** Uses the same input-station arrangement as the cell's embedded rail radar. */
  stackedStations?: boolean;
}) {
  const blueprint = useMemo(
    () => buildRailBrick(stackedStations ? -inputs.length : inputs.length, outputs.length),
    [inputs.length, outputs.length, stackedStations],
  );
  if (!('blueprint' in blueprint)) throw new Error('rail brick builder returned a book');

  return (
    <section class="cell-layout" aria-label="Layout">
      <RailBlueprintPreview blueprint={blueprint.blueprint} embedded />
    </section>
  );
}
