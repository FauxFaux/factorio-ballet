import './design-card.css';
import type {
  AssemblerSpecification,
  KernelProblem,
  ResourceRates,
} from '../../kernel-problems.ts';
import { CARBON_LIGHT_SHORT } from '../../data/colours.ts';
import { GenericFluidIcon, GenericSolidIcon } from '../icon.tsx';
import { DesignPreview } from './design-preview.tsx';

/** A read-only summary of one kernel problem and its proposed factory design. */
export function DesignCard({ index, problem }: { index: number; problem: KernelProblem }) {
  const title = problem.name;
  const resourceColours = resourceColoursFor(problem);

  return (
    <article class="design-card" aria-labelledby={`design-card-title-${index}`}>
      <aside class="design-card-description" aria-label={`${title} description`}>
        <h3 id={`design-card-title-${index}`}>{title}</h3>
        <FlowSummary
          inputs={problem.inputs}
          outputs={problem.outputs}
          resourceColours={resourceColours}
        />
        <AssemblerList assemblers={problem.assemblers} resourceColours={resourceColours} />
      </aside>
      <div class="design-card-grid">
        <DesignPreview column={problem.design.columns[0]} label={`${title} preview`} />
      </div>
    </article>
  );
}

function FlowSummary({
  inputs,
  outputs,
  resourceColours,
}: Pick<KernelProblem, 'inputs' | 'outputs'> & { resourceColours: ResourceColours }) {
  return (
    <section class="design-card-flow" aria-label="Problem inputs and outputs">
      <RateSummary
        rates={{ ...inputs.solids, ...inputs.fluids }}
        resourceColours={resourceColours}
      />
      <span class="design-card-flow-arrow" aria-hidden="true">
        →
      </span>
      <RateSummary
        rates={{ ...outputs.solids, ...outputs.fluids }}
        resourceColours={resourceColours}
      />
    </section>
  );
}

function AssemblerList({
  assemblers,
  resourceColours,
}: {
  assemblers: AssemblerSpecification[];
  resourceColours: ResourceColours;
}) {
  return (
    <section class="design-card-assemblers" aria-label="Assembler specifications">
      <h4>Assemblers</h4>
      {assemblers.map((assembler) => (
        <div class="design-card-assembler" key={assembler.name}>
          <h5>{assembler.name}</h5>
          <div class="design-card-assembler-flow">
            <RateSummary rates={assembler.inputPerSecond} resourceColours={resourceColours} />
            <span class="design-card-flow-arrow" aria-hidden="true">
              →
            </span>
            <RateSummary rates={assembler.outputPerSecond} resourceColours={resourceColours} />
          </div>
        </div>
      ))}
    </section>
  );
}

type ResourceColours = Record<string, string>;

function RateSummary({
  rates,
  resourceColours,
}: {
  rates: ResourceRates;
  resourceColours: ResourceColours;
}) {
  const entries = Object.entries(rates);
  if (entries.length === 0) return <span>none</span>;

  return (
    <span class="design-card-rate-summary">
      {entries.map(([resource, rate], index) => (
        <span class="design-card-rate" key={resource} aria-label={`${rate} ${resource}`}>
          {index > 0 && <span class="design-card-rate-plus">+</span>}
          <span>{rate}</span>
          <ResourceIcon resource={resource} color={resourceColours[resource]} />
        </span>
      ))}
    </span>
  );
}

function ResourceIcon({ resource, color }: { resource: string; color: string }) {
  const Icon = resource.startsWith('fluid ') ? GenericFluidIcon : GenericSolidIcon;

  return (
    <span class="design-card-rate-icon" title={resource}>
      <Icon color={color} />
    </span>
  );
}

function resourceColoursFor(problem: KernelProblem): ResourceColours {
  const resourceNames = [
    ...Object.keys(problem.inputs.solids),
    ...Object.keys(problem.inputs.fluids),
    ...Object.keys(problem.outputs.solids),
    ...Object.keys(problem.outputs.fluids),
    ...problem.assemblers.flatMap((assembler) => [
      ...Object.keys(assembler.inputPerSecond),
      ...Object.keys(assembler.outputPerSecond),
    ]),
  ];
  const palette = Object.values(CARBON_LIGHT_SHORT);

  return Object.fromEntries(
    [...new Set(resourceNames)].map((resource, index) => [
      resource,
      palette[index % palette.length],
    ]),
  );
}
