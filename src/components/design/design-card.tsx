import './design-card.css';
import type {
  AssemblerSpecification,
  KernelProblem,
  ResourceRates,
} from '../../kernel-problems.ts';
import { DesignPreview } from './design-preview.tsx';

/** A read-only summary of one kernel problem and its proposed factory design. */
export function DesignCard({ index, problem }: { index: number; problem: KernelProblem }) {
  const title = problem.name;

  return (
    <article class="design-card" aria-labelledby={`design-card-title-${index}`}>
      <aside class="design-card-description" aria-label={`${title} description`}>
        <h3 id={`design-card-title-${index}`}>{title}</h3>
        <FlowSummary inputs={problem.inputs} outputs={problem.outputs} />
        <AssemblerList assemblers={problem.assemblers} />
      </aside>
      <div class="design-card-grid">
        <DesignPreview column={problem.design.columns[0]} label={`${title} preview`} />
      </div>
    </article>
  );
}

function FlowSummary({ inputs, outputs }: Pick<KernelProblem, 'inputs' | 'outputs'>) {
  return (
    <section class="design-card-flow" aria-label="Problem inputs and outputs">
      <RateSummary rates={{ ...inputs.solids, ...inputs.fluids }} />
      <span class="design-card-flow-arrow" aria-hidden="true">
        →
      </span>
      <RateSummary rates={{ ...outputs.solids, ...outputs.fluids }} />
    </section>
  );
}

function AssemblerList({ assemblers }: { assemblers: AssemblerSpecification[] }) {
  return (
    <section class="design-card-assemblers" aria-label="Assembler specifications">
      <h4>Assemblers</h4>
      {assemblers.map((assembler) => (
        <div class="design-card-assembler" key={assembler.name}>
          <h5>{assembler.name}</h5>
          <div class="design-card-assembler-flow">
            <RateSummary rates={assembler.inputPerSecond} />
            <span class="design-card-flow-arrow" aria-hidden="true">
              →
            </span>
            <RateSummary rates={assembler.outputPerSecond} />
          </div>
        </div>
      ))}
    </section>
  );
}

function RateSummary({ rates }: { rates: ResourceRates }) {
  const entries = Object.entries(rates);
  if (entries.length === 0) return <span>none</span>;

  return (
    <span class="design-card-rate-summary">
      {entries.map(([resource, rate]) => `${rate} ${resource}`).join(' + ')}
    </span>
  );
}
