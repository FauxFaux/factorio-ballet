import { describe, expect, it } from 'vitest';
import { assemblerColumnLayout } from '../src/components/cell/radar-layout.ts';

describe('assemblerColumnLayout', () => {
  it('wraps assemblers that exceed the radar height into another column', () => {
    const layout = assemblerColumnLayout(3, 3, 34);

    expect(layout.assemblers).toHaveLength(34);
    expect(layout.assemblers[32]).toEqual({ column: 0, row: 32 });
    expect(layout.assemblers[33]).toEqual({ column: 1, row: 0 });
    expect(layout.height).toBe(99);
    expect(layout.width).toBe(10);
  });

  it('keeps a fitting stack in one column', () => {
    const layout = assemblerColumnLayout(3, 3, 33);

    expect(layout.assemblers[32]).toEqual({ column: 0, row: 32 });
    expect(layout.width).toBe(3);
  });
});
