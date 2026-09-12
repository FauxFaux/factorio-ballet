import './rail-blueprints.css';
import { CopyIcon } from '@primer/octicons-react';
import { useState } from 'preact/hooks';
import { toWords } from 'ts-number-to-words/src/index.ts';
import {
  buildRailBrick,
  encodeBlueprintDocument,
  RAIL_BRICK_MAX_STATIONS,
} from '../bp/rail-blueprint.ts';
import { RailBlueprintPreview } from './rail-blueprint-preview.tsx';
import { RailBlueprintSchematicPreview } from './rail-blueprint-schematic-preview.tsx';

/** A standalone rail-brick blueprint sized from the station counts in URL state. */
export function RailBlueprints({
  size: [signedInputCount, signedOutputCount],
  onSizeChange,
}: {
  size: [number, number];
  onSizeChange: (update: (size: [number, number]) => [number, number]) => void;
}) {
  const [copied, setCopied] = useState(false);
  const inputCount = Math.abs(signedInputCount);
  const outputCount = Math.abs(signedOutputCount);
  const inputStacked = signedInputCount < 0;
  const blueprintDocument = buildRailBrick(
    inputStacked ? signedInputCount : inputCount,
    outputCount,
  );
  if (!('blueprint' in blueprintDocument)) throw new Error('rail brick builder returned a book');
  const blueprint = encodeBlueprintDocument(blueprintDocument);
  const setCount = (index: 0 | 1, count: number) =>
    onSizeChange(([inputs, outputs]) => {
      const currentCount = index === 0 ? inputs : outputs;
      const otherCount = Math.abs(index === 0 ? outputs : inputs);
      const currentStacked = index === 0 && currentCount < 0;
      const otherStacked = index === 1 && inputs < 0;
      const maximum = currentStacked
        ? 9
        : otherStacked
          ? 11
          : Math.min(RAIL_BRICK_MAX_STATIONS - 1, RAIL_BRICK_MAX_STATIONS - otherCount);
      const constrainedCount = Math.max(currentStacked ? 2 : 0, Math.min(count, maximum));
      const signedCount = currentStacked ? -constrainedCount : constrainedCount;
      return index === 0 ? [signedCount, Math.abs(outputs)] : [inputs, signedCount];
    });
  const setInputStacked = (stacked: boolean) =>
    onSizeChange(([inputs, outputs]) => {
      const count = Math.abs(inputs);
      const outputCount = Math.abs(outputs);
      const constrainedCount = stacked
        ? Math.max(2, Math.min(count, 9))
        : Math.min(count, RAIL_BRICK_MAX_STATIONS - 1, RAIL_BRICK_MAX_STATIONS - outputCount);
      const signedCount = stacked ? -constrainedCount : constrainedCount;
      return [signedCount, stacked ? Math.min(outputCount, 11) : outputCount];
    });

  const inputDescription = `${inputStacked ? 'stacked ' : ''}input`;

  return (
    <section class="rail-blueprints" aria-labelledby="rail-blueprints-title">
      <h2 id="rail-blueprints-title">Rail blueprints</h2>
      <p>
        Standard rail brick with {toWords(inputCount)} {inputDescription} and {toWords(outputCount)}{' '}
        output stations.
      </p>
      <fieldset class="rail-blueprints-counts">
        <legend>Station counts</legend>
        {(['Input', 'Output'] as const).map((side, index) => {
          const count = index === 0 ? inputCount : outputCount;
          const stacked = index === 0 && inputStacked;
          const otherStacked = index === 1 && inputStacked;
          return (
            <div class="rail-blueprints-count" key={side}>
              <div class="rail-blueprints-count-header">
                <span>
                  {side} stations: {count}
                </span>
                {index === 0 && (
                  <label
                    class={`rail-blueprints-stacked${!stacked && count >= 6 ? ' rail-blueprints-stacked-recommended' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={stacked}
                      onChange={(event) =>
                        setInputStacked((event.currentTarget as HTMLInputElement).checked)
                      }
                    />
                    Stacked
                  </label>
                )}
              </div>
              <input
                type="range"
                aria-label={`${side} stations: ${count}`}
                min={stacked ? 2 : 0}
                max={stacked ? 9 : otherStacked ? 11 : RAIL_BRICK_MAX_STATIONS - 1}
                step={1}
                value={count}
                list="rail-blueprints-count-ticks"
                onInput={(event) =>
                  setCount(index as 0 | 1, Number((event.target as HTMLInputElement).value))
                }
              />
            </div>
          );
        })}
        <datalist id="rail-blueprints-count-ticks">
          {Array.from({ length: RAIL_BRICK_MAX_STATIONS + 1 }, (_, count) => (
            <option value={count} key={count} />
          ))}
        </datalist>
      </fieldset>
      <div class="rail-blueprints-previews">
        <RailBlueprintSchematicPreview size={[signedInputCount, outputCount]} />
        <RailBlueprintPreview blueprint={blueprintDocument.blueprint} />
      </div>
      <div class="rail-blueprints-export">
        <div class="rail-blueprints-export-header">
          <span>Blueprint</span>
          <button
            class="rail-blueprints-copy"
            type="button"
            onClick={() => {
              setCopied(true);
              void navigator.clipboard.writeText(blueprint).catch(() => undefined);
            }}
            onMouseOut={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) setCopied(false);
            }}
          >
            {copied ? (
              'Copied!'
            ) : (
              <>
                <CopyIcon aria-hidden="true" /> Copy
              </>
            )}
          </button>
        </div>
        <textarea aria-label="Blueprint" readOnly rows={6} value={blueprint} />
      </div>
    </section>
  );
}
