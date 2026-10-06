import { describe, expect, it } from 'vitest';
import { connectionPath, modulePortAngle } from '../../src/components/layout/connection-path.ts';

describe('connection curves', () => {
  it('keeps endpoint tangents aligned with rotated ports, including parallel connections', () => {
    const start = { x: 10, y: 20 };
    const end = { x: 40, y: 60 };
    const rotations = ['north', 'east', 'south', 'west'] as const;
    const edges = ['right', 'bottom', 'left', 'top'] as const;
    const vectors = [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
    ];
    for (const [rotationIndex, rotation] of rotations.entries()) {
      for (const [edgeIndex, edge] of edges.entries()) {
        const port = { edge, x: 0, transport: 'belt' as const };
        const outgoing = modulePortAngle(port, rotation, 'output');
        const incoming = modulePortAngle(port, rotation, 'input');
        expect(outgoing % 360).toBe(((edgeIndex + rotationIndex) % 4) * 90);
        expect(incoming).toBe(outgoing + 180);
        const normal = vectors[(edgeIndex + rotationIndex) % 4]!;
        for (const bend of [0, 3, -3]) {
          const numbers = connectionPath(start, end, outgoing, incoming, bend)
            .match(/-?\d+(?:\.\d+)?/g)!
            .map(Number);
          const [sx, sy, ax, ay, bx, by, ex, ey] = numbers as [
            number,
            number,
            number,
            number,
            number,
            number,
            number,
            number,
          ];
          expect([sx, sy, ex, ey]).toEqual([10, 20, 40, 60]);
          expect((ax - sx) * normal.y - (ay - sy) * normal.x).toBe(0);
          expect((bx - ex) * normal.y - (by - ey) * normal.x).toBe(0);
          expect((ax - sx) * normal.x + (ay - sy) * normal.y).toBeGreaterThan(0);
          expect((bx - ex) * normal.x + (by - ey) * normal.y).toBeGreaterThan(0);
        }
      }
    }
  });
});
