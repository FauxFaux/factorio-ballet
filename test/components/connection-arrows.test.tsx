// @vitest-environment happy-dom

import { cleanup } from '@testing-library/preact';
import { afterEach, expect, it } from 'vitest';
import { render } from '../render-with-dataset.tsx';
import {
  ConnectionArrows,
  type ConnectionArrowPoint,
} from '../../src/components/layout/connection-arrow.tsx';

afterEach(cleanup);

it('shares an icon across adjacent lanes while retaining separate resources, entities, flows and distant groups', () => {
  const arrow: ConnectionArrowPoint = {
    id: '0',
    owner: 'module',
    point: { x: 0, y: 0 },
    angle: 270,
    side: 'output',
    resource: 'item:copper-cable',
  };
  const arrows: ConnectionArrowPoint[] = [
    ...[0, 1, 2, 3].map((x) => ({ ...arrow, id: `lane:${x}`, point: { x, y: 0 } })),
    { ...arrow, id: 'distant', point: { x: 8, y: 0 } },
    { ...arrow, id: 'resource', resource: 'item:copper-plate' },
    { ...arrow, id: 'entity', owner: 'other' },
    { ...arrow, id: 'flow', side: 'input' },
    { ...arrow, id: 'edge', angle: 0 },
  ];
  const { container } = render(
    <svg>
      <ConnectionArrows arrows={arrows} />
    </svg>,
  );
  expect(container.querySelectorAll('.cell-layout-connection-arrow path')).toHaveLength(9);
  expect(container.querySelectorAll('.cell-layout-connection-arrow image')).toHaveLength(6);
  expect(container.querySelectorAll('.cell-layout-connection-arrow title')).toHaveLength(9);
});
