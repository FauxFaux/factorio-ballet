import './bobs-layout.css';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Cell } from '../../cell.ts';
import type { Solution } from '../../solve/index.ts';
import type { ResourceId } from '../../types.ts';
import { useDataset } from '../../dataset/context.tsx';
import { BobLayoutDrawing } from './bobs-layout-drawing.tsx';
import { defaultBobPairOptions, type BobPairOptions } from '../../compute/bobs/paired-options.ts';
import { bobProblem } from '../../compute/bobs/problem.ts';
import {
  defaultBobOptions,
  type BobOptions,
  type BobProblem,
  type BobResult,
  type BobAttempt,
} from '../../compute/bobs/types.ts';

const fields: { key: keyof BobOptions; label: string }[] = [
  { key: 'maxWidth', label: 'Max width' },
  { key: 'maxHeight', label: 'Max height' },
  { key: 'maxChests', label: 'Relay chests' },
  { key: 'maxInserters', label: 'Inserters' },
  { key: 'maxTimeInSeconds', label: 'Seconds' },
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
      return { problem: bobProblem(ds, cell, solution, progress, inputs, outputs, Infinity) };
    } catch (error) {
      return { error: String(error instanceof Error ? error.message : error) };
    }
  }, [ds, cell.entries, solution, progress, inputs, outputs]);
  const problemKey = JSON.stringify(request);
  const [options, setOptions] = useState<BobOptions>(() =>
    defaultBobOptions(request.problem ?? { machines: [], inputs: [], outputs: [] }),
  );
  const [mode, setMode] = useState('refinement');
  const [pairOptions, setPairOptions] = useState(defaultBobPairOptions);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const optionsRef = useRef<BobPairOptions>({ ...options, ...pairOptions });
  optionsRef.current = { ...options, ...pairOptions };
  const [run, setRun] = useState(0);
  const controller = useRef<AbortController>();
  const [state, setState] = useState<{
    key: string;
    result?: BobResult;
    error?: string;
    running?: boolean;
    attempts?: BobAttempt[];
  }>();
  const stateKey = `${problemKey}:${run}`;
  const current = state?.key === stateKey ? state : undefined;
  const [selectedAttempt, setSelectedAttempt] = useState<{ key: string; id: number }>();
  const visibleAttempt =
    current?.attempts?.find(
      (a) => selectedAttempt?.key === stateKey && a.id === selectedAttempt.id,
    ) ?? current?.attempts?.at(-1);
  const layout = visibleAttempt?.layout ?? current?.result?.layout;
  useEffect(() => {
    const snapshot = JSON.parse(problemKey) as { problem?: BobProblem; error?: string };
    if (!snapshot.problem) return;
    const abort = new AbortController();
    controller.current = abort;
    let active = true;
    setState({ key: stateKey, running: true });
    void import('../../compute/bobs/bobs-solver.ts')
      .then(({ solveBobLayout, solveBobPairedLayout }) => {
        if (!active) return;
        if (typeof window !== 'undefined' && !globalThis.crossOriginIsolated) {
          throw new Error(
            'Local solving needs cross-origin isolation. Serve with Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp.',
          );
        }
        const solve = modeRef.current === 'paired' ? solveBobPairedLayout : solveBobLayout;
        return solve(snapshot.problem!, optionsRef.current, abort.signal, (attempt) => {
          if (!active) return;
          setState((previous) => {
            const attempts = previous?.key === stateKey ? [...(previous.attempts ?? [])] : [];
            attempts[attempt.id - 1] = attempt;
            return { key: stateKey, running: true, attempts };
          });
        });
      })
      .then((result) => {
        if (active)
          setState((previous) => ({
            key: stateKey,
            result,
            attempts: result?.attempts ?? previous?.attempts,
          }));
      })
      .catch((error: unknown) => {
        if (active)
          setState((previous) => ({
            key: stateKey,
            attempts: previous?.attempts,
            error: abort.signal.aborted
              ? 'Search stopped.'
              : String(error instanceof Error ? error.message : error),
          }));
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
        boundary chest per external item. Fluid connections assumed correct. Compact layouts are
        heuristic.
        {mode === 'paired'
          ? ' Choose rate-balanced pairings once, minimize base distance, then anneal bases with machines fixed. No placement retries or relay chests.'
          : ' Place assemblers, then connect items; retry with difficult inserters reserved.'}
      </p>
      <form
        class="bobs-layout-controls"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setRun((r) => r + 1);
        }}
      >
        <label>
          Solve mode
          <select value={mode} onChange={(event) => setMode(event.currentTarget.value)}>
            <option value="refinement">Placement refinement</option>
            <option value="paired">Fixed pairings + base annealing</option>
          </select>
        </label>
        {fields
          .filter((f) => mode !== 'paired' || f.key !== 'maxChests')
          .map(({ key, label }) => (
            <label key={key}>
              {mode === 'paired' && key === 'maxTimeInSeconds' ? 'Placement seconds' : label}
              <input
                type="number"
                step="any"
                value={options[key]}
                onInput={(event) =>
                  setOptions((o) => ({ ...o, [key]: event.currentTarget.valueAsNumber }))
                }
              />
            </label>
          ))}
        {mode === 'paired' &&
          (
            [
              { key: 'pairingSeconds', label: 'Pairing seconds' },
              { key: 'annealingSeconds', label: 'Annealing seconds' },
              {
                key: 'pairingCapacity',
                label: 'Pairing items/s',
              },
            ] as const
          ).map(({ key, label }) => (
            <label key={key}>
              {label}
              <input
                type="number"
                step="any"
                value={pairOptions[key]}
                onInput={(event) =>
                  setPairOptions((o) => ({ ...o, [key]: event.currentTarget.valueAsNumber }))
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
      {!!current?.attempts?.length && (
        <ol class="bobs-layout-attempts" aria-label="Placement attempts">
          {current.attempts.map((attempt) => (
            <li key={attempt.id}>
              <button
                type="button"
                class="cell-btn"
                aria-pressed={visibleAttempt?.id === attempt.id}
                onClick={() => setSelectedAttempt({ key: stateKey, id: attempt.id })}
              >
                Attempt {attempt.id}:{' '}
                {attempt.stage === 'solved'
                  ? 'Connected'
                  : attempt.stage === 'conflict'
                    ? 'Conflict'
                    : current.running
                      ? 'Connecting'
                      : 'Unconnected'}
                {' · '}
                {attempt.layout.width}×{attempt.layout.height}
              </button>
            </li>
          ))}
        </ol>
      )}
      {layout && (
        <>
          <BobLayoutDrawing
            layout={layout}
            problem={request.problem!}
            conflicts={visibleAttempt?.conflicts}
          />
          {visibleAttempt && (
            <div class="bobs-layout-attempt-status">
              <p>{visibleAttempt.message}</p>
              {visibleAttempt.layout.transport === 'relaxed' ? (
                <p>
                  Relaxed pairing sketch: arrows show intended connections, not legal inserters.
                </p>
              ) : (
                visibleAttempt.stage !== 'solved' &&
                visibleAttempt.layout.inserters.length > 0 && (
                  <p>Shown inserters are placement hints; transport is incomplete.</p>
                )
              )}
              {visibleAttempt.conflicts.length > 0 && (
                <ul>
                  {visibleAttempt.conflicts.map((conflict, i) => (
                    <li key={i}>{conflict.message}</li>
                  ))}
                </ul>
              )}
              {visibleAttempt.promoted.length > 0 && (
                <p>{visibleAttempt.promoted.length} difficult ports reserved during placement.</p>
              )}
            </div>
          )}
          <p class="bobs-layout-status">
            {layout.width}×{layout.height} tiles · perimeter {2 * (layout.width + layout.height)} ·{' '}
            {layout.width * layout.height} tiles² · {layout.inserters.length}{' '}
            {layout.transport === 'relaxed' ? 'paired bases (unvalidated)' : 'inserters'} ·{' '}
            {layout.nodes.filter((n) => n.kind === 'chest').length} relay chests
          </p>
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
