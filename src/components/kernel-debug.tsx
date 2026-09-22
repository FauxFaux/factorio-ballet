import './kernel-debug.css';
import type { Chosen } from '../data/index.ts';
import { generateAssemblerDesign, isAssemblerDesignFailure } from '../compute/assembler-design.ts';
import { inserterItemsPerSecondForBeltAtProgress } from '../data/inserter-throughput.ts';
import { allKernelProblems } from '../compute/kernel-problems.ts';
import { fmt } from '../ts.ts';
import { DesignCard } from './design/design-card.tsx';

export function KernelDebug({ progress, chosen }: { progress: number; chosen: Chosen }) {
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

  return (
    <section class="kernel-design" aria-labelledby="kernel-design-title">
      <h2 id="kernel-design-title">Kernel design</h2>
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
      <p>Built in solver's results for various situations.</p>
      <div class="kernel-design-cards" aria-label="Kernel problems">
        {sortedProblems.map(({ problem, index }) => (
          <DesignCard index={index} problem={problem} throughput={throughput} />
        ))}
      </div>
    </section>
  );
}
