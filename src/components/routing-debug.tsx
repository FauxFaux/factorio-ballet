import './routing-debug.css';
import { useEffect, useId, useState } from 'preact/hooks';
import type { RoutingDebugState } from '../boot/url-handler.tsx';
import type { State } from '../ts.ts';

function gridDimension(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function RoutingDebug({ state }: { state: State<RoutingDebugState | undefined> }) {
  const [settings, setSettings] = state;
  const width = gridDimension(settings?.width, 96);
  const height = gridDimension(settings?.height, 64);
  const [draftWidth, setDraftWidth] = useState(String(width));
  const [draftHeight, setDraftHeight] = useState(String(height));
  const gridId = useId();

  useEffect(() => {
    setDraftWidth(String(width));
    setDraftHeight(String(height));
  }, [width, height]);

  return (
    <section class="routing-debug" aria-labelledby="routing-debug-title">
      <h2 id="routing-debug-title">Routing debug</h2>
      <div class="routing-debug-controls">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const nextWidth = Number(draftWidth);
            const nextHeight = Number(draftHeight);
            if (
              !Number.isSafeInteger(nextWidth) ||
              nextWidth < 1 ||
              !Number.isSafeInteger(nextHeight) ||
              nextHeight < 1
            )
              return;
            setSettings((previous) => ({ ...previous, width: nextWidth, height: nextHeight }));
          }}
        >
          <fieldset class="routing-debug-size">
            <legend>Grid size</legend>
            <label>
              Width
              <input
                type="number"
                min="1"
                step="1"
                required
                value={draftWidth}
                onInput={(event) => setDraftWidth(event.currentTarget.value)}
              />
            </label>
            <span aria-hidden="true">×</span>
            <label>
              Height
              <input
                type="number"
                min="1"
                step="1"
                required
                value={draftHeight}
                onInput={(event) => setDraftHeight(event.currentTarget.value)}
              />
            </label>
            <span>tiles</span>
            <button type="submit">Resize grid</button>
          </fieldset>
        </form>
      </div>
      {/* One SVG unit is one tile, with (0, 0) at the top-left corner. Future shapes and
          pointer coordinates share this space regardless of the responsive display size. */}
      <svg
        class="routing-debug-grid"
        role="img"
        aria-label={`Empty routing grid, ${width} by ${height} tiles`}
        viewBox={`0 0 ${width} ${height}`}
        style={{ aspectRatio: `${width} / ${height}` }}
      >
        <defs>
          <pattern id={`${gridId}-tile`} width="1" height="1" patternUnits="userSpaceOnUse">
            <path
              class="routing-debug-grid-minor"
              d="M 1 0 H 0 V 1"
              vector-effect="non-scaling-stroke"
            />
          </pattern>
          <pattern id={`${gridId}-major`} width="8" height="8" patternUnits="userSpaceOnUse">
            <path
              class="routing-debug-grid-major"
              d="M 8 0 H 0 V 8"
              vector-effect="non-scaling-stroke"
            />
          </pattern>
        </defs>
        <g aria-hidden="true" pointer-events="none">
          <rect width={width} height={height} fill={`url(#${gridId}-tile)`} />
          <rect width={width} height={height} fill={`url(#${gridId}-major)`} />
        </g>
      </svg>
    </section>
  );
}
