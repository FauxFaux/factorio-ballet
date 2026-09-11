import './rail-blueprints.css';
import { toWords } from 'ts-number-to-words/src/index.ts';
import {
  buildRailBrick,
  encodeBlueprintDocument,
  RAIL_BRICK_MAX_STATIONS,
} from '../bp/rail-blueprint.ts';
import { RailBlueprintPreview } from './rail-blueprint-preview.tsx';

/** A standalone rail-brick blueprint sized from the station counts in URL state. */
export function RailBlueprints({
  size: [inputCount, outputCount],
  onSizeChange,
}: {
  size: [number, number];
  onSizeChange: (update: (size: [number, number]) => [number, number]) => void;
}) {
  const blueprint = encodeBlueprintDocument(buildRailBrick(inputCount, outputCount));
  const setCount = (index: 0 | 1, count: number) =>
    onSizeChange(([inputs, outputs]) => (index === 0 ? [count, outputs] : [inputs, count]));

  return (
    <section class="rail-blueprints" aria-labelledby="rail-blueprints-title">
      <h2 id="rail-blueprints-title">Rail blueprints</h2>
      <p>
        Standard rail brick with {toWords(inputCount)} input and {toWords(outputCount)} output
        stations.
      </p>
      <fieldset class="rail-blueprints-counts">
        <legend>Station counts</legend>
        <label>
          <span>Input stations: {inputCount}</span>
          <input
            type="range"
            min={0}
            max={RAIL_BRICK_MAX_STATIONS}
            step={1}
            value={inputCount}
            list="rail-blueprints-count-ticks"
            onInput={(event) => setCount(0, Number((event.target as HTMLInputElement).value))}
          />
        </label>
        <label>
          <span>Output stations: {outputCount}</span>
          <input
            type="range"
            min={0}
            max={RAIL_BRICK_MAX_STATIONS}
            step={1}
            value={outputCount}
            list="rail-blueprints-count-ticks"
            onInput={(event) => setCount(1, Number((event.target as HTMLInputElement).value))}
          />
        </label>
        <datalist id="rail-blueprints-count-ticks">
          {Array.from({ length: RAIL_BRICK_MAX_STATIONS + 1 }, (_, count) => (
            <option value={count} key={count} />
          ))}
        </datalist>
      </fieldset>
      <RailBlueprintPreview size={[inputCount, outputCount]} />
      <label class="rail-blueprints-export">
        Blueprint
        <textarea readOnly rows={6} value={blueprint} />
      </label>
    </section>
  );
}
