import './kernel-design.css';
import { kernelProblems } from '../kernel-problems.ts';
import { DesignCard } from './design/design-card.tsx';

/** The standalone workspace where a reusable factory kernel will be composed. */
export function KernelDesign() {
  return (
    <section class="kernel-design" aria-labelledby="kernel-design-title">
      <h2 id="kernel-design-title">Kernel design</h2>
      <p>Design reusable factory kernels for the following production problems.</p>
      <div class="kernel-design-cards" aria-label="Kernel problems">
        {kernelProblems.map((problem, index) => (
          <DesignCard key={problem.name} index={index} problem={problem} />
        ))}
      </div>
    </section>
  );
}
