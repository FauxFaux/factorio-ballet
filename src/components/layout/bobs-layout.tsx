import './bobs-layout.css';
import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import type { Cell } from '../../cell.ts';
import type { Solution } from '../../solve/index.ts';
import type { ResourceId } from '../../types.ts';
import { useDataset } from '../../dataset/context.tsx';
import { resourceName } from '../../data/index.ts';
import { bobProblem } from '../../compute/bobs/problem.ts';
import {
  defaultBobOptions,
  type BobOptions,
  type BobProblem,
  type BobResult,
} from '../../compute/bobs/types.ts';

const inserterColors = ['#fcd34d', '#67e8f9', '#f9a8d4', '#bef264', '#c4b5fd', '#fdba74'];

const fields: { key: keyof BobOptions; label: string; min: number; max: number }[] = [
  { key: 'maxWidth', label: 'Max width', min: 1, max: 128 },
  { key: 'maxHeight', label: 'Max height', min: 1, max: 128 },
  { key: 'maxChests', label: 'Relay chests', min: 0, max: 32 },
  { key: 'maxInserters', label: 'Inserters', min: 0, max: 128 },
  { key: 'maxTimeInSeconds', label: 'Seconds', min: 1, max: 120 },
];

export function BobsLayoutSurface({
  cell,
  solution,
  progress,
  inputs,
  outputs,
}: {
  cell: Cell;
  solution: Solution;
  progress: number;
  inputs: ResourceId[];
  outputs: ResourceId[];
}) {
  const ds = useDataset();
  const request = useMemo(() => {
    try {
      return { problem: bobProblem(ds, cell, solution, progress, inputs, outputs) };
    } catch (error) {
      return { error: String(error instanceof Error ? error.message : error) };
    }
  }, [ds, cell.entries, solution, progress, inputs, outputs]);
  const problemKey = JSON.stringify(request);
  const [options, setOptions] = useState<BobOptions>(() =>
    defaultBobOptions(request.problem ?? { machines: [], inputs: [], outputs: [] }),
  );
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [run, setRun] = useState(0);
  const controller = useRef<AbortController>();
  const [state, setState] = useState<{
    key: string;
    result?: BobResult;
    error?: string;
    running?: boolean;
  }>();
  const stateKey = `${problemKey}:${run}`;
  const current = state?.key === stateKey ? state : undefined;
  const layout = current?.result?.layout;
  const markerId = useId();
  const gridId = useId();
  useEffect(() => {
    const snapshot = JSON.parse(problemKey) as { problem?: BobProblem; error?: string };
    if (!snapshot.problem) return;
    const abort = new AbortController();
    controller.current = abort;
    let active = true;
    setState({ key: stateKey, running: true });
    void import('../../compute/bobs/bobs-solver.ts')
      .then(({ solveBobLayout }) => {
        if (!active) return;
        if (typeof window !== 'undefined' && !globalThis.crossOriginIsolated) {
          throw new Error(
            'Local solving needs cross-origin isolation. Serve with Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp.',
          );
        }
        return solveBobLayout(snapshot.problem!, optionsRef.current, abort.signal);
      })
      .then((result) => {
        if (active) setState({ key: stateKey, result });
      })
      .catch((error: unknown) => {
        if (active)
          setState({
            key: stateKey,
            error: abort.signal.aborted
              ? 'Search stopped.'
              : String(error instanceof Error ? error.message : error),
          });
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [problemKey, stateKey]);

  return (
    <section class="bobs-layout" aria-label="Bob layout">
      <p class="bobs-layout-description">
        Bob’s inserters · reach ≤3 Manhattan tiles · 2160°/s · extension 6 tiles/s · hand 24. One
        boundary chest per external item. Fluid connections assumed correct. Minimize perimeter,
        then inserters and relay chests.
      </p>
      <form
        class="bobs-layout-controls"
        onSubmit={(event) => {
          event.preventDefault();
          setRun((r) => r + 1);
        }}
      >
        {fields.map(({ key, label, min, max }) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min={min}
              max={max}
              step="1"
              required
              value={options[key]}
              onInput={(event) =>
                setOptions((o) => ({ ...o, [key]: event.currentTarget.valueAsNumber }))
              }
            />
          </label>
        ))}
        <button class="cell-btn" type="submit" disabled={!request.problem}>
          Solve
        </button>
        {current?.running && (
          <button class="cell-btn" type="button" onClick={() => controller.current?.abort()}>
            Stop
          </button>
        )}
      </form>
      <p role="status" class="bobs-layout-status">
        {request.error ??
          current?.error ??
          (current?.running ? 'Searching for a compact layout…' : current?.result?.message)}
      </p>
      {layout && (
        <>
          <p class="bobs-layout-status">
            {layout.width}×{layout.height} tiles · perimeter {2 * (layout.width + layout.height)} ·{' '}
            {layout.width * layout.height} tiles² · {layout.inserters.length} inserters ·{' '}
            {layout.nodes.filter((n) => n.kind === 'chest').length} relay chests
          </p>
          <svg
            class="bobs-layout-canvas"
            role="img"
            aria-label="Bob assembler layout"
            viewBox={`-0.3 -0.3 ${layout.width + 0.6} ${layout.height + 0.6}`}
          >
            <defs>
              <pattern id={gridId} width="1" height="1" patternUnits="userSpaceOnUse">
                <path d="M 1 0 H 0 V 1" class="bobs-layout-grid" />
              </pattern>
              {inserterColors.map((color, i) => (
                <marker
                  key={color}
                  id={`${markerId}-${i}`}
                  viewBox="-2 -2 14 14"
                  refX="8"
                  refY="5"
                  markerWidth="4.2"
                  markerHeight="4.2"
                  orient="auto-start-reverse"
                >
                  <path class="bobs-layout-arrowhead" d="M 0 0 L 10 5 L 0 10 z" fill={color} />
                </marker>
              ))}
            </defs>
            <rect width={layout.width} height={layout.height} fill={`url(#${gridId})`} />
            {layout.nodes.map((node) => (
              <g key={node.id}>
                <title>
                  {node.resource
                    ? `${node.kind === 'source' ? 'Source' : 'Sink'}: ${resourceName(ds.data, node.resource)}`
                    : node.label}
                </title>
                <rect
                  class={`bobs-layout-node is-${node.kind}`}
                  x={node.position.x + 0.06}
                  y={node.position.y + 0.06}
                  width={node.size.width - 0.12}
                  height={node.size.height - 0.12}
                />
                <text
                  class="bobs-layout-label"
                  x={node.position.x + node.size.width / 2}
                  y={node.position.y + node.size.height / 2}
                >
                  {node.kind === 'assembler'
                    ? problemLabel(request.problem!, node.id)
                    : node.kind === 'source'
                      ? 'IN'
                      : node.kind === 'sink'
                        ? 'OUT'
                        : 'C'}
                </text>
              </g>
            ))}
            {layout.inserters.map((inserter, i) => {
              const pivot = { x: inserter.position.x + 0.5, y: inserter.position.y + 0.5 };
              const pickup = { x: inserter.pickup.x + 0.5, y: inserter.pickup.y + 0.5 };
              const dropoff = { x: inserter.dropoff.x + 0.5, y: inserter.dropoff.y + 0.5 };
              const pickupLength = Math.hypot(pickup.x - pivot.x, pickup.y - pivot.y);
              const dropoffLength = Math.hypot(dropoff.x - pivot.x, dropoff.y - pivot.y);
              // Round a substantial part of each arm, leaving straight ends for the arrowhead.
              const bend = Math.min(0.9, pickupLength / 2, dropoffLength / 2);
              const entryRatio = pickupLength > 0 ? bend / pickupLength : 0;
              const exitRatio = dropoffLength > 0 ? bend / dropoffLength : 0;
              const entry = {
                x: pivot.x + (pickup.x - pivot.x) * entryRatio,
                y: pivot.y + (pickup.y - pivot.y) * entryRatio,
              };
              const exit = {
                x: pivot.x + (dropoff.x - pivot.x) * exitRatio,
                y: pivot.y + (dropoff.y - pivot.y) * exitRatio,
              };
              const path = `M ${pickup.x} ${pickup.y} L ${entry.x} ${entry.y} Q ${pivot.x} ${pivot.y} ${exit.x} ${exit.y} L ${dropoff.x} ${dropoff.y}`;
              return (
                <g key={i} style={{ color: inserterColors[i % inserterColors.length] }}>
                  <title>
                    {Object.entries(inserter.rates)
                      .map(([r, rate]) => `${resourceName(ds.data, r as ResourceId)}: ${rate}/s`)
                      .join(', ')}
                    ; capacity {inserter.capacity.toFixed(1)}/s
                  </title>
                  <path class="bobs-layout-arm-border" d={path} />
                  <path
                    class="bobs-layout-arm"
                    d={path}
                    marker-end={`url(#${markerId}-${i % inserterColors.length})`}
                  />
                  <rect
                    class="bobs-layout-inserter"
                    x={inserter.position.x + 0.44}
                    y={inserter.position.y + 0.44}
                    width="0.12"
                    height="0.12"
                  />
                </g>
              );
            })}
          </svg>
          <ol class="bobs-layout-legend">
            {request.problem?.machines.map((machine, i) => (
              <li key={machine.id}>
                {i + 1}: {machine.label}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function problemLabel(problem: BobProblem, id: string): number {
  return problem.machines.findIndex((machine) => machine.id === id) + 1;
}
