import { CpModel, CpSat, setCloudNoticeEnabled } from 'or-tools-wasm/cp-sat';
import { describe, expect, it } from 'vitest';
import { addBobPlacementSymmetry } from '../../src/compute/bobs/placement-symmetry.ts';

type Shape = { x: number; y: number; w: number; h: number };
type World = { width: number; height: number; rectangles: Shape[] };
const original: World = {
  width: 5,
  height: 4,
  rectangles: [
    { x: 0, y: 0, w: 1, h: 2 },
    { x: 2, y: 2, w: 2, h: 1 },
  ],
};
function transform(world: World, transpose: boolean, flipX: boolean, flipY: boolean): World {
  return {
    width: transpose ? world.height : world.width,
    height: transpose ? world.width : world.height,
    rectangles: world.rectangles.map((r) => {
      const x = flipX ? world.width - r.x - r.w : r.x;
      const y = flipY ? world.height - r.y - r.h : r.y;
      return transpose ? { x: y, y: x, w: r.h, h: r.w } : { ...r, x, y };
    }),
  };
}
async function allowed(world: World, maxWidth: number, maxHeight: number, leftToRight = false) {
  const model = new CpModel();
  const constant = (n: number, name: string) => model.newIntVar(n, n, name);
  const width = constant(world.width, 'width'),
    height = constant(world.height, 'height');
  const rectangles = world.rectangles.map((r, i) => ({
    x: constant(r.x, `${i}:x`),
    y: constant(r.y, `${i}:y`),
    w: constant(r.w, `${i}:w`),
    h: constant(r.h, `${i}:h`),
    right: constant(r.x + r.w, `${i}:right`),
    bottom: constant(r.y + r.h, `${i}:bottom`),
  }));
  addBobPlacementSymmetry(model, width, height, rectangles, maxWidth, maxHeight, leftToRight);
  return (await CpSat.solve(model, { maxTimeInSeconds: 1, numWorkers: 1 })).hasSolution;
}
setCloudNoticeEnabled(false);

describe('Bob placement symmetry', () => {
  it('keeps exactly one of eight rotated and reflected labelled worlds', async () => {
    const accepted: boolean[] = [];
    for (const transpose of [false, true])
      for (const x of [false, true])
        for (const y of [false, true]) {
          accepted.push(await allowed(transform(original, transpose, x, y), 8, 8));
        }
    expect(accepted.filter(Boolean)).toHaveLength(1);
  });

  it('preserves a representative when swapped dimensions exceed asymmetric bounds', async () => {
    const accepted: boolean[] = [];
    for (const x of [false, true])
      for (const y of [false, true])
        accepted.push(await allowed(transform(original, false, x, y), 5, 4));
    expect(accepted.filter(Boolean)).toHaveLength(1);
  });

  it('removes only top/bottom reflection when left/right flow fixes orientation', async () => {
    const accepted: boolean[] = [];
    for (const x of [false, true])
      for (const y of [false, true])
        accepted.push(await allowed(transform(original, false, x, y), 8, 8, true));
    // Both left/right orientations survive: reflecting x is not equivalent with fixed edges.
    expect(accepted.filter(Boolean)).toHaveLength(2);
    expect(
      await allowed({ width: 6, height: 2, rectangles: [{ x: 0, y: 0, w: 6, h: 1 }] }, 8, 8, true),
    ).toBe(true);
  });
});
