import { describe, expect, it } from 'vitest';
import { elkLayout } from '../../src/components/layout/elk-layout.ts';

describe('ELK layout bridge', () => {
  it('lays out sized nodes from left to right and returns routed edge points', async () => {
    const result = await elkLayout({
      direction: 'right',
      nodes: [
        { id: 'input_0', width: 12, height: 25.5 },
        { id: 'module_0', width: 8, height: 12 },
      ],
      edges: [{ id: 'edge_0', source: 'input_0', target: 'module_0' }],
    });

    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.find((node) => node.id === 'input_0')).toMatchObject({
      width: 12,
      height: 25.5,
    });
    expect(result.nodes.find((node) => node.id === 'input_0')!.x).toBeLessThan(
      result.nodes.find((node) => node.id === 'module_0')!.x,
    );
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]!.points.length).toBeGreaterThanOrEqual(2);
    expect(
      result.edges[0]!.points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)),
    ).toBe(true);
  });
});
