import { describe, expect, it } from 'vitest';
import {
  stackedInputStationStop,
  stackedRailPath,
  stationStop,
} from '../src/components/cell/radar-rail.tsx';

describe('stackedRailPath', () => {
  it('assigns each bus resource to its station stop position', () => {
    expect(stationStop('in', 0)).toEqual({ x: 10, y: 84 });
    expect(stationStop('in', 2)).toEqual({ x: 26, y: 84 });
    expect(stationStop('out', 0)).toEqual({ x: 182, y: 38 });
    expect(stationStop('out', 2)).toEqual({ x: 166, y: 38 });
    expect(stationStop('in', 2, true)).toEqual(stackedInputStationStop(2));
  });

  it('keeps its 12-tile station pitch as an explicit wide layout', () => {
    expect(stationStop('in', 2, false, 'wide')).toEqual({ x: 34, y: 84 });
    expect(stationStop('out', 2, false, 'wide')).toEqual({ x: 158, y: 38 });
  });

  it('omits input trunks and attachments when there are no stations', () => {
    const path = stackedRailPath(0, 0);
    expect(path).not.toContain('M 4 13 c 0 6, 4 7, 4 11 l 0 80');
    expect(path).not.toContain('M 4 20');
    expect(path).not.toContain('M 60 40');
  });

  it('adds input stations from the bottom upwards', () => {
    const path = stackedRailPath(3, 0);
    expect(path).not.toContain('M 4 20');
    expect(path).toContain('M 4 13 c 0 6, 4 7, 4 11 l 0 80');
    expect(path).toContain('M 60 100 l 0 12 c 0 7, 8 11, 16 11');
    expect(path).toContain('M 8 104 c 0 4, 4 8, 8 8 l 36 0 c 8 0, 8 11, 24 11');
    expect(path).not.toContain('l 0 80 c');
    expect(path).toContain('M 8 104');
    expect(path).toContain('M 8 94');
    expect(path).toContain('M 8 84');
    expect(stackedInputStationStop(0)).toEqual({ x: 48, y: 112 });
    expect(stackedInputStationStop(2)).toEqual({ x: 48, y: 92 });
  });

  it('retains the original output-station loops', () => {
    expect(stackedRailPath(1, 1)).toContain('M 188 13 c 0 8, -8 12, -8 20 l 0 60');
  });

  it('blends a lone bottom station directly onto the bottom border', () => {
    const path = stackedRailPath(1, 0);
    expect(path).toContain('M 8 104 c 0 4, 4 8, 8 8 l 36 0 c 8 0, 8 11, 24 11');
    expect(path).not.toContain('M 60');
  });
});
