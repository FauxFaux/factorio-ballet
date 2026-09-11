import './rail-blueprints.css';
import { buildRailBrick, encodeBlueprintDocument } from '../bp/rail-blueprint.ts';
import { NO_CHOICE } from '../data/index.ts';
import type { Solution } from '../solve/index.ts';
import type { ResourceId } from '../types.ts';
import { CellRadar } from './cell/radar.tsx';

const emptySolution: Solution = {
  counts: [],
  rates: [],
  balance: new Map(),
  inputRates: [],
  outputRates: [],
  complete: true,
  notes: [],
};

function stationResources(direction: 'input' | 'output', count: number): ResourceId[] {
  return Array.from(
    { length: count },
    (_, index) => `item:rail-blueprint-${direction}-${index + 1}` as ResourceId,
  );
}

/** A standalone rail-brick blueprint sized from the station counts in URL state. */
export function RailBlueprints({ size: [inputCount, outputCount] }: { size: [number, number] }) {
  const blueprint = encodeBlueprintDocument(buildRailBrick(inputCount, outputCount));

  return (
    <section class="rail-blueprints" aria-labelledby="rail-blueprints-title">
      <h2 id="rail-blueprints-title">Rail blueprints</h2>
      <p>
        Standard rail brick with {inputCount} input and {outputCount} output stations.
      </p>
      <CellRadar
        title={`${inputCount} input, ${outputCount} output blueprint`}
        inputs={stationResources('input', inputCount)}
        outputs={stationResources('output', outputCount)}
        entries={[]}
        solution={emptySolution}
        belt={NO_CHOICE.belt}
        progress={0}
        stackedStations={false}
      />
      <label class="rail-blueprints-export">
        Blueprint
        <textarea readOnly rows={6} value={blueprint} />
      </label>
    </section>
  );
}
