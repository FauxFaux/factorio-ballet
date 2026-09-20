import './design-card.css';
import type { FactoryDesign } from '../../design.ts';
import { DesignPreview } from './design-preview.tsx';

/** A read-only summary of a single kernel design. */
export function DesignCard({ index, design }: { index: number; design: FactoryDesign }) {
  const title = `Design ${index + 1}`;

  return (
    <article class="design-card" aria-labelledby={`design-card-title-${index}`}>
      <aside class="design-card-controls" aria-label={`${title} controls`}>
        <h3 id={`design-card-title-${index}`}>{title}</h3>
        <div class="design-card-control-space">
          <p>Controls</p>
        </div>
      </aside>
      <div class="design-card-grid">
        <DesignPreview column={design.columns[0]} label={`${title} preview`} />
      </div>
    </article>
  );
}
