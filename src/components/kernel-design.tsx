import './kernel-design.css';
import { newFactoryDesign } from '../design.ts';
import { DesignCard } from './design/design-card.tsx';

const designs = Array.from({ length: 10 }, () => newFactoryDesign());

/** The standalone workspace where a reusable factory kernel will be composed. */
export function KernelDesign() {
  return (
    <section class="kernel-design" aria-labelledby="kernel-design-title">
      <h2 id="kernel-design-title">Kernel design</h2>
      <p>Design a reusable factory kernel.</p>
      <div class="kernel-design-cards" aria-label="Kernel designs">
        {designs.map((design, index) => (
          <DesignCard key={index} index={index} design={design} />
        ))}
      </div>
    </section>
  );
}
