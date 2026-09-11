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
  size: [signedInputCount, signedOutputCount],
  onSizeChange,
}: {
  size: [number, number];
  onSizeChange: (update: (size: [number, number]) => [number, number]) => void;
}) {
  const inputCount = Math.abs(signedInputCount);
  const outputCount = Math.abs(signedOutputCount);
  const inputStacked = signedInputCount < 0;
  const outputStacked = signedOutputCount < 0;
  const blueprint = encodeBlueprintDocument(buildRailBrick(inputCount, outputCount));
  const setCount = (index: 0 | 1, count: number) =>
    onSizeChange(([inputs, outputs]) => {
      const currentCount = index === 0 ? inputs : outputs;
      const otherCount = Math.abs(index === 0 ? outputs : inputs);
      const currentStacked = currentCount < 0;
      const otherStacked = (index === 0 ? outputs : inputs) < 0;
      const maximum = currentStacked ? 9 : otherStacked ? 11 : RAIL_BRICK_MAX_STATIONS - otherCount;
      const constrainedCount = Math.max(currentStacked ? 2 : 0, Math.min(count, maximum));
      const signedCount = currentCount < 0 ? -constrainedCount : constrainedCount;
      return index === 0 ? [signedCount, outputs] : [inputs, signedCount];
    });
  const setStacked = (index: 0 | 1, stacked: boolean) =>
    onSizeChange(([inputs, outputs]) => {
      const count = Math.abs(index === 0 ? inputs : outputs);
      const other = index === 0 ? outputs : inputs;
      const otherCount = Math.abs(other);
      const otherStacked = other < 0;
      const constrainedCount = stacked
        ? Math.max(2, Math.min(count, 9))
        : Math.min(count, otherStacked ? 11 : RAIL_BRICK_MAX_STATIONS - otherCount);
      const signedCount = stacked ? -constrainedCount : constrainedCount;
      const constrainedOther = stacked && !otherStacked ? Math.min(otherCount, 11) : otherCount;
      const signedOther = otherStacked ? -constrainedOther : constrainedOther;
      return index === 0 ? [signedCount, signedOther] : [signedOther, signedCount];
    });

  const inputDescription = `${inputStacked ? 'stacked ' : ''}input`;
  const outputDescription = `${outputStacked ? 'stacked ' : ''}output`;

  return (
    <section class="rail-blueprints" aria-labelledby="rail-blueprints-title">
      <h2 id="rail-blueprints-title">Rail blueprints</h2>
      <p>
        Standard rail brick with {toWords(inputCount)} {inputDescription} and {toWords(outputCount)}{' '}
        {outputDescription} stations.
      </p>
      <fieldset class="rail-blueprints-counts">
        <legend>Station counts</legend>
        {(['Input', 'Output'] as const).map((side, index) => {
          const count = index === 0 ? inputCount : outputCount;
          const stacked = index === 0 ? inputStacked : outputStacked;
          const otherStacked = index === 0 ? outputStacked : inputStacked;
          return (
            <div class="rail-blueprints-count" key={side}>
              <label>
                <span>
                  {side} stations: {count}
                </span>
                <input
                  type="range"
                  min={stacked ? 2 : 0}
                  max={stacked ? 9 : otherStacked ? 11 : RAIL_BRICK_MAX_STATIONS}
                  step={1}
                  value={count}
                  list="rail-blueprints-count-ticks"
                  onInput={(event) =>
                    setCount(index as 0 | 1, Number((event.target as HTMLInputElement).value))
                  }
                />
              </label>
              <label
                class={`rail-blueprints-stacked${!stacked && count >= 6 ? ' rail-blueprints-stacked-recommended' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={stacked}
                  onChange={(event) =>
                    setStacked(index as 0 | 1, (event.currentTarget as HTMLInputElement).checked)
                  }
                />
                Stacked
              </label>
            </div>
          );
        })}
        <datalist id="rail-blueprints-count-ticks">
          {Array.from({ length: RAIL_BRICK_MAX_STATIONS + 1 }, (_, count) => (
            <option value={count} key={count} />
          ))}
        </datalist>
      </fieldset>
      <RailBlueprintPreview size={[signedInputCount, signedOutputCount]} />
      <label class="rail-blueprints-export">
        Blueprint
        <textarea readOnly rows={6} value={blueprint} />
      </label>
    </section>
  );
}
