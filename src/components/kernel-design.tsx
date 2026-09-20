import './kernel-design.css';
import { useState } from 'preact/hooks';
import { newFactoryDesign, type FactoryDesign } from '../design.ts';
import { DesignCard } from './design/design-card.tsx';

/** The standalone workspace where a reusable factory kernel will be composed. */
export function KernelDesign() {
  const [designs, setDesigns] = useState<FactoryDesign[]>(() =>
    Array.from({ length: 10 }, () => newFactoryDesign()),
  );

  return (
    <section class="kernel-design" aria-labelledby="kernel-design-title">
      <h2 id="kernel-design-title">Kernel design</h2>
      <p>Design a reusable factory kernel.</p>
      <div class="kernel-design-cards" aria-label="Kernel designs">
        {designs.map((design, index) => (
          <DesignCard
            key={index}
            index={index}
            design={design}
            onDesignChange={(update) =>
              setDesigns((previous) =>
                previous.map((current, currentIndex) =>
                  currentIndex === index ? update(current) : current,
                ),
              )
            }
          />
        ))}
      </div>
    </section>
  );
}
