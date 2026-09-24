import './kernel-debug.css';
import type { Chosen } from '../data/index.ts';
import { generateAssemblerDesign, isAssemblerDesignFailure } from '../compute/assembler-design.ts';
import { inserterItemsPerSecondForBeltAtProgress } from '../data/inserter-throughput.ts';
import { allKernelProblems, kernelMachineChoices } from '../compute/kernel-problems.ts';
import { fmt } from '../ts.ts';
import { DesignCard } from './design/design-card.tsx';
import { KernelCustomProblem } from './kernel-custom-problem.tsx';
import type { KernelCustomState } from '../boot/url-handler.tsx';
import type { State } from '../ts.ts';

export function KernelDebug({
  progress,
  chosen,
  custom,
}: {
  progress: number;
  chosen: Chosen;
  custom: State<KernelCustomState | undefined>;
}) {
  const throughput = {
    beltItemsPerSecond: chosen.belt.itemsPerSecond,
    inserterItemsPerSecond: inserterItemsPerSecondForBeltAtProgress(progress, chosen.belt),
    longInserterItemsPerSecond: inserterItemsPerSecondForBeltAtProgress(progress, chosen.belt, 2),
  };
  const sortedProblems = allKernelProblems
    .map((problem, index) => ({ problem, index }))
    .toSorted(
      (left, right) =>
        Number(isAssemblerDesignFailure(generateAssemblerDesign(left.problem, throughput))) -
        Number(isAssemblerDesignFailure(generateAssemblerDesign(right.problem, throughput))),
    );
  const useProblem = (problem: (typeof allKernelProblems)[number]) => {
    const assembler = problem.assemblers[0];
    if (!assembler) return;
    const machine = kernelMachineChoices.find(({ label }) => label === assembler.name);
    const building = assembler.name.startsWith('Air filter')
      ? 'air-filter'
      : (machine?.value ?? (assembler.name.startsWith('Assembler') ? 'assembler' : undefined));
    custom[1]((current) => ({
      building: building ?? current?.building ?? 'assembler',
      flows: {
        solidInputs: Object.values(problem.inputs.solids),
        fluidInputs: Object.values(problem.inputs.fluids),
        solidOutputs: Object.values(problem.outputs.solids),
        fluidOutputs: Object.values(problem.outputs.fluids),
      },
      ...(current?.rates ? { rates: current.rates } : {}),
    }));
  };

  return (
    <section class="kernel-design" aria-labelledby="kernel-design-title">
      <h2 id="kernel-design-title">Kernel design</h2>
      <KernelCustomProblem throughput={throughput} custom={custom} />
      <section class="kernel-design-examples" aria-labelledby="kernel-design-examples-title">
        <h3 id="kernel-design-examples-title">Built in solver's results for various situations</h3>
        <dl class="kernel-design-throughput" aria-label="Transport throughput">
          <div>
            <dt>Belt throughput</dt>
            <dd>{fmt(throughput.beltItemsPerSecond)} items/s</dd>
          </div>
          <div>
            <dt>Inserter throughput</dt>
            <dd>{fmt(throughput.inserterItemsPerSecond)} items/s</dd>
          </div>
          <div>
            <dt>Long inserter throughput</dt>
            <dd>{fmt(throughput.longInserterItemsPerSecond)} items/s</dd>
          </div>
        </dl>
        <div class="kernel-design-cards" aria-label="Kernel problems">
          {sortedProblems.map(({ problem, index }) => (
            <DesignCard
              index={index}
              problem={problem}
              throughput={throughput}
              onUseProblem={() => useProblem(problem)}
            />
          ))}
        </div>
      </section>
    </section>
  );
}
