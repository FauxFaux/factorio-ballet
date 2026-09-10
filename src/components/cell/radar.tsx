import './radar.css';
import type { CellEntry } from '../../cell.ts';
import type { Solution } from '../../solve/index.ts';
import type { Belt, ResourceId } from '../../types.ts';
import type { RefObject } from 'preact';
import { RadarAssemblers } from './radar-assemblers.tsx';
import { RailBorder, railPath, stackedRailPath, StationStops } from './radar-rail.tsx';

/** RADAR's rail view adapted to one cell. Its 192-by-128 coordinates are deliberately schematic. */
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
  onExpand?: () => void;
  expandButtonRef?: RefObject<HTMLButtonElement>;
}) {
  const stationSummary = `${inputs.length} input and ${outputs.length} output stations`;
  const stacked = inputs.length + outputs.length > 4;
  const assemblerStartX = stacked ? 68 : 8 + inputs.length * 8;
  const props = {
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
  };
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
          <RadarGraphic {...props} decorative />
        </button>
      ) : (
        <RadarGraphic {...props} />
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
      <RadarAssemblers
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
