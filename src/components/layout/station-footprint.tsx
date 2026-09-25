import type { Blueprint, Position } from '../../bp/decode.ts';
import type { ResourceId } from '../../types.ts';
import { iconSprite } from '../icon.tsx';
import { embeddedBlueprintOffset } from '../rail-blueprint-preview.tsx';
import { stationStop } from '../radar/radar-rail.tsx';

function StationResourceIcon({ resource, x, y }: { resource: ResourceId; x: number; y: number }) {
  const [url, spriteX, spriteY, sheetSize] = iconSprite(
    resource,
    resource.startsWith('fluid:') ? 'fluid:fluid-unknown' : 'item:item-unknown',
  );
  return (
    <g data-layout-resource={resource}>
      <title>{resource}</title>
      <rect class="cell-layout-station-icon-backdrop" x={x} y={y} width="4.5" height="4.5" />
      <svg
        class="cell-layout-station-icon"
        x={x}
        y={y}
        width="4.5"
        height="4.5"
        viewBox={`${spriteX} ${spriteY} 32 32`}
        aria-hidden="true"
      >
        <image href={url} width={sheetSize} height={sheetSize} />
      </svg>
    </g>
  );
}

/**
 * A deliberately coarse version of the solid-request station in
 * docs/blueprints/solid-request-1.json. Coordinates are in game tiles relative
 * to the train stop: paired production blocks straddle the track.
 */
function SolidRequestFootprint() {
  return (
    <g class="cell-layout-station-footprint">
      {/* The 4 by 4 silo anchors, extended into 4 by 7 layout guide rectangles. */}
      <rect
        class="cell-layout-station-building"
        x="-4"
        y="-20.5"
        width="5"
        height="7"
        data-layout-building="-2,-17"
      />
      <rect
        class="cell-layout-station-building"
        x="3"
        y="-20.5"
        width="5"
        height="7"
        data-layout-building="6,-17"
      />
      <rect
        class="cell-layout-station-building"
        x="-4"
        y="-13.5"
        width="5"
        height="7"
        data-layout-building="-2,-10"
      />
      <rect
        class="cell-layout-station-building"
        x="3"
        y="-13.5"
        width="5"
        height="7"
        data-layout-building="6,-10"
      />
      {/* combinators */}
      <rect class="cell-layout-station-building" x="-1" y="-5" width="2" height="8.5" />
      {/* the belt corner, drawn as a building as it's ugly othrewise */}
      <rect class="cell-layout-station-building" x="-3.5" y="-6" width="2.5" height="5" />
      <rect class="cell-layout-station-belt" x="3" y="-6" width="5" height="10" />
      {/* Fast splitters 111 and 113: centres (+5, +4.5) and (+7, +4.5). */}
      <rect
        class="cell-layout-station-splitter"
        x="4"
        y="4"
        width="2"
        height="1"
        data-layout-splitter="5,4.5"
      />
      <rect
        class="cell-layout-station-splitter"
        x="6"
        y="4"
        width="2"
        height="1"
        data-layout-splitter="7,4.5"
      />
    </g>
  );
}

/** A coarse version of the north-facing solid-provide station. */
function SolidProvideFootprint() {
  return (
    <g class="cell-layout-station-footprint">
      {/* The two silo anchors at (-6, +10) and (-6, +17), widened towards the rail. */}
      <rect
        class="cell-layout-station-building"
        x="-8"
        y="6.5"
        width="5"
        height="7"
        data-layout-output-building="-6,10"
      />
      <rect
        class="cell-layout-station-building"
        x="-8"
        y="13.5"
        width="5"
        height="7"
        data-layout-output-building="-6,17"
      />
      {/* Three belts and the northern underground-belt endpoint span (-8, +4) to (-4, +5). */}
      <rect
        class="cell-layout-station-belt"
        x="-8"
        y="2"
        width="4"
        height="4"
        data-layout-output-belt="north"
      />
    </g>
  );
}

/**
 * Locate ordinary input stops on their actual vertical station rails. The first path reaches
 * farther down the fan, so its stop is lower than the following paths. This deliberately does
 * not reuse the radar's schematic coordinates.
 */
export function inputStationFootprintStops(
  blueprint: Blueprint,
  count: number,
  stacked: boolean,
): Position[] {
  const offset = embeddedBlueprintOffset(blueprint);
  if (!stacked && offset) {
    return Array.from({ length: count }, (_, index) => {
      const railX = 27 + index * 12;
      const rails = (blueprint.entities ?? []).filter(
        (entity) =>
          entity.name === 'straight-rail' &&
          (entity.direction ?? 0) === 0 &&
          entity.position.x === railX,
      );
      const lowerRail = Math.max(...rails.map((rail) => rail.position.y));
      return { x: railX - 2 + offset.x, y: lowerRail - 4 + offset.y };
    });
  }

  // The stacked fixture has horizontal bays and needs its own rotated footprint treatment. Keep
  // the existing radar placement until that separate layout is introduced.
  return Array.from({ length: count }, (_, index) => stationStop('in', index, stacked));
}

/** Locate output stops at the upper end of their rendered vertical station rails. */
export function outputStationFootprintStops(blueprint: Blueprint, count: number): Position[] {
  const offset = embeddedBlueprintOffset(blueprint);
  if (!offset) return [];
  return Array.from({ length: count }, (_, index) => {
    const railX = 197 - index * 12;
    const rails = (blueprint.entities ?? []).filter(
      (entity) =>
        entity.name === 'straight-rail' &&
        (entity.direction ?? 0) === 0 &&
        entity.position.x === railX,
    );
    const upperRail = Math.min(...rails.map((rail) => rail.position.y));
    return { x: railX + 2 + offset.x, y: upperRail + 4 + offset.y };
  });
}

/** Render one solid-request footprint beside every input train stop. */
export function InputStationFootprints({
  stops,
  resources,
}: {
  stops: Position[];
  resources: ResourceId[];
}) {
  return (
    <svg
      class="cell-layout-stations"
      viewBox="0 0 192 128"
      aria-label={`${stops.length} input station ${stops.length === 1 ? 'footprint' : 'footprints'}`}
    >
      {stops.map((stop, index) => (
        <g key={index} transform={`translate(${stop.x} ${stop.y})`} data-layout-station={index + 1}>
          <SolidRequestFootprint />
          {resources[index] && (
            <StationResourceIcon resource={resources[index]} x={-3.75} y={-12.25} />
          )}
        </g>
      ))}
    </svg>
  );
}

/** Render one solid-provide footprint beside every output train stop. */
export function OutputStationFootprints({
  stops,
  resources,
}: {
  stops: Position[];
  resources: ResourceId[];
}) {
  return (
    <svg
      class="cell-layout-stations"
      viewBox="0 0 192 128"
      aria-label={`${stops.length} output station ${stops.length === 1 ? 'footprint' : 'footprints'}`}
    >
      {stops.map((stop, index) => (
        <g
          key={index}
          transform={`translate(${stop.x} ${stop.y})`}
          data-layout-output-station={index + 1}
        >
          <SolidProvideFootprint />
          {resources[index] && (
            <StationResourceIcon resource={resources[index]} x={-7.75} y={7.75} />
          )}
        </g>
      ))}
    </svg>
  );
}
