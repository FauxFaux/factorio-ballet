import { CellRadar } from './cell/radar.tsx';
import type { ResourceId } from '../types.ts';

/** Temporary visual fixture for comparing every supported stacked input count at once. */
export function RadarStationGallery() {
  return (
    <section
      aria-label="Radar station gallery"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(19rem, 1fr))',
        gap: '1rem',
      }}
    >
      {Array.from({ length: 11 }, (_, inputCount) => (
        <CellRadar
          key={inputCount}
          title={`${inputCount} input stations`}
          inputs={Array.from(
            { length: inputCount },
            (_, index) => `item:temporary-radar-input-${index + 1}` as ResourceId,
          )}
          outputs={[]}
          entries={[]}
          counts={[]}
          progress={0}
        />
      ))}
    </section>
  );
}
