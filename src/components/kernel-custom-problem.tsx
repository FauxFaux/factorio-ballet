import type { ComponentChildren } from 'preact';
import { UndoIcon } from '@primer/octicons-react';
import type { AssemblerDesignThroughput } from '../compute/assembler-design.ts';
import type { KernelCustomState } from '../boot/url-handler.tsx';
import {
  airFilterProblem,
  assemblerProblem,
  kernelMachineChoices,
  machineProblem,
  type KernelProblem,
} from '../compute/kernel-problems.ts';
import { fmt, type State } from '../ts.ts';
import { DesignCard, resourceColoursFor } from './design/design-card.tsx';
import { GenericFluidIcon, GenericSolidIcon, resourceIconStyle } from './icon.tsx';

type FlowKind = 'solidInputs' | 'fluidInputs' | 'solidOutputs' | 'fluidOutputs';
type Flows = KernelCustomState['flows'];

interface FlowGroup {
  kind: FlowKind;
  title: string;
  resource: string;
  fluid: boolean;
}

const flowSides: { title: string; groups: FlowGroup[] }[] = [
  {
    title: 'Inputs',
    groups: [
      { kind: 'solidInputs', title: 'Input items', resource: 'item', fluid: false },
      { kind: 'fluidInputs', title: 'Input fluids', resource: 'fluid', fluid: true },
    ],
  },
  {
    title: 'Outputs',
    groups: [
      { kind: 'solidOutputs', title: 'Output items', resource: 'item', fluid: false },
      { kind: 'fluidOutputs', title: 'Output fluids', resource: 'fluid', fluid: true },
    ],
  },
];

function withinRange(value: number, min: number, max: number) {
  return Math.round(Math.min(max, Math.max(min, value)) * 10) / 10;
}

function resourceNamesFor(problem: KernelProblem): Record<FlowKind, string[]> {
  return {
    solidInputs: Object.keys(problem.inputs.solids),
    fluidInputs: Object.keys(problem.inputs.fluids),
    solidOutputs: Object.keys(problem.outputs.solids),
    fluidOutputs: Object.keys(problem.outputs.fluids),
  };
}

function defaultCustomState(): KernelCustomState {
  return {
    building: 'assembler',
    flows: { solidInputs: [5], fluidInputs: [], solidOutputs: [2], fluidOutputs: [] },
  };
}

export function KernelCustomProblem({
  throughput,
  custom,
}: {
  throughput: AssemblerDesignThroughput;
  custom: State<KernelCustomState | undefined>;
}) {
  const [stored, setStored] = custom;
  const { building, flows } = stored ?? defaultCustomState();
  const rates = stored?.rates ?? {
    beltItemsPerSecond: withinRange(throughput.beltItemsPerSecond, 7.5, 75),
    inserterItemsPerSecond: withinRange(throughput.inserterItemsPerSecond, 0.5, 40),
    longInserterItemsPerSecond: withinRange(throughput.longInserterItemsPerSecond, 0.5, 40),
  };
  const updateCustom = (update: (current: KernelCustomState) => KernelCustomState) =>
    setStored((current) => update(current ?? defaultCustomState()));
  const setRates = (update: (current: AssemblerDesignThroughput) => AssemblerDesignThroughput) =>
    updateCustom((current) => ({ ...current, rates: update(current.rates ?? rates) }));
  const resetRates = () => updateCustom(({ rates: _rates, ...current }) => current);

  const filter = airFilterProblem({ width: 5, height: 5 }).assemblers[0]!;
  const problemForFlows = (values: Flows) =>
    building === 'assembler'
      ? assemblerProblem({ assemblerName: 'Assembler 2', ...values })
      : building === 'air-filter'
        ? assemblerProblem({
            assemblerName: 'Air filter 5×5',
            ...values,
            size: filter.size,
            fluidBoxes: filter.fluidBoxes,
          })
        : machineProblem(building, values);
  const problem = problemForFlows(flows);
  const colours = resourceColoursFor(problem);
  const resourceNames = resourceNamesFor(problem);

  const addFlow = (kind: FlowKind, rate: number) =>
    updateCustom((current) => ({
      ...current,
      flows: { ...current.flows, [kind]: [...current.flows[kind], rate] },
    }));
  const removeFlow = (kind: FlowKind, index: number) =>
    updateCustom((current) => ({
      ...current,
      flows: {
        ...current.flows,
        [kind]: current.flows[kind].filter((_, flowIndex) => flowIndex !== index),
      },
    }));
  const setFlowRate = (kind: FlowKind, index: number, rate: number) =>
    updateCustom((current) => ({
      ...current,
      flows: {
        ...current.flows,
        [kind]: current.flows[kind].map((oldRate, flowIndex) =>
          flowIndex === index ? rate : oldRate,
        ),
      },
    }));

  return (
    <section class="kernel-custom" aria-labelledby="kernel-custom-title">
      <h3 id="kernel-custom-title">Your problem</h3>
      <div class="kernel-custom-layout">
        <div class="kernel-custom-controls">
          <label class="kernel-custom-building">
            Building
            <select
              value={building}
              onChange={(event) => {
                const building = event.currentTarget.value as KernelCustomState['building'];
                updateCustom((current) => ({
                  ...current,
                  building,
                }));
              }}
            >
              <option value="assembler">Assembler 2</option>
              <option value="air-filter">5×5 air filter</option>
              {kernelMachineChoices.map(({ value, label }) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div class="kernel-custom-flows">
            <fieldset
              class="kernel-custom-flow-group kernel-custom-throughputs"
              aria-labelledby="kernel-custom-throughputs-title"
            >
              <legend>
                <span id="kernel-custom-throughputs-title">Throughputs</span>
                <button
                  type="button"
                  class="kernel-custom-reset-rates"
                  title="Reset throughputs to overall game progress"
                  aria-label="Reset throughputs to overall game progress"
                  disabled={!stored?.rates}
                  onClick={resetRates}
                >
                  <UndoIcon aria-hidden="true" />
                </button>
              </legend>
              <RateSlider
                label="Belt throughput"
                title="Belt throughput in items per second"
                icon={<TransportIcon item="bob-ultimate-transport-belt" />}
                inline
                value={rates.beltItemsPerSecond}
                min={7.5}
                max={75}
                onChange={(value) =>
                  setRates((current) => ({ ...current, beltItemsPerSecond: value }))
                }
              />
              <RateSlider
                label="Inserter throughput"
                title="Regular 180 degree bulk inserter throughput in items per second"
                icon={<TransportIcon item="bob-express-bulk-inserter" />}
                inline
                value={rates.inserterItemsPerSecond}
                min={0.5}
                max={40}
                onChange={(value) =>
                  setRates((current) => ({ ...current, inserterItemsPerSecond: value }))
                }
              />
              <RateSlider
                label="Long inserter throughput"
                title="Regular 180 degree 2-tile long inserter throughput in items per second"
                icon={<TransportIcon item="bob-red-bulk-inserter" />}
                inline
                value={rates.longInserterItemsPerSecond}
                min={0.5}
                max={40}
                onChange={(value) =>
                  setRates((current) => ({ ...current, longInserterItemsPerSecond: value }))
                }
              />
            </fieldset>
            {flowSides.map(({ title, groups }) => (
              <fieldset class="kernel-custom-flow-group" key={title}>
                <legend>{title}</legend>
                {groups.flatMap(({ kind, title: flowTitle, resource, fluid }) =>
                  flows[kind].map((rate, index) => (
                    <div class="kernel-custom-flow" key={`${kind}-${index}`}>
                      {fluid ? (
                        <span
                          class="kernel-custom-fluid"
                          aria-label={`${flowTitle} ${index + 1}: 200/s`}
                        >
                          <ResourceIcon fluid color={colours[resourceNames[kind][index]!]} />
                          <output>200/s</output>
                        </span>
                      ) : (
                        <RateSlider
                          label={`${flowTitle} ${index + 1} rate`}
                          icon={<ResourceIcon color={colours[resourceNames[kind][index]!]} />}
                          inline
                          value={rate}
                          min={0.1}
                          max={150}
                          onChange={(value) => setFlowRate(kind, index, value)}
                        />
                      )}
                      <button
                        type="button"
                        class="kernel-custom-remove"
                        title={`Remove ${resource} ${index + 1}`}
                        aria-label={`Remove ${resource} ${index + 1}`}
                        onClick={() => removeFlow(kind, index)}
                      >
                        ×
                      </button>
                    </div>
                  )),
                )}
                <div class="kernel-custom-add-actions">
                  {groups.map(({ kind, resource, fluid }) => {
                    const nextRate = fluid ? 200 : 5;
                    const nextProblem = problemForFlows({
                      ...flows,
                      [kind]: [...flows[kind], nextRate],
                    });
                    const nextResource = resourceNamesFor(nextProblem)[kind].at(-1)!;
                    const nextColour = resourceColoursFor(nextProblem)[nextResource];
                    return (
                      <button
                        type="button"
                        class="kernel-custom-add"
                        title={`Add ${resource}`}
                        aria-label={`Add ${resource}`}
                        onClick={() => addFlow(kind, nextRate)}
                        key={kind}
                      >
                        +
                        <ResourceIcon fluid={fluid} color={nextColour} />
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
        </div>
        <div class="kernel-custom-result" aria-label="Your problem result">
          <DesignCard index={-1} problem={problem} throughput={rates} />
        </div>
      </div>
    </section>
  );
}

function RateSlider({
  label,
  title,
  icon,
  inline = false,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  title?: string;
  icon?: ComponentChildren;
  inline?: boolean;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label class={inline ? 'kernel-custom-slider is-inline' : 'kernel-custom-slider'} title={title}>
      <span>{icon ?? label}</span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step="0.1"
        value={value}
        onInput={(event) => onChange(Number(event.currentTarget.value))}
      />
      <output>{fmt(value)}/s</output>
    </label>
  );
}

function ResourceIcon({ fluid = false, color }: { fluid?: boolean; color: string }) {
  const Icon = fluid ? GenericFluidIcon : GenericSolidIcon;
  return (
    <span class="kernel-custom-resource-icon" aria-hidden="true">
      <Icon color={color} />
    </span>
  );
}

function TransportIcon({ item }: { item: string }) {
  return (
    <span class="kernel-custom-transport-icon" aria-hidden="true">
      <span style={resourceIconStyle(`item:${item}`)} />
    </span>
  );
}
