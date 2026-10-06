import { bobsInserterPerformance, type InserterPerformance } from './inserter-performance.ts';

/**
 * Temporary estimates until upstream measurements are supplied. Replace these tables with
 * upstream data here; the dataset and all solver callers already select this separate profile.
 */
export const upstreamInserterPerformance: InserterPerformance = {
  ...bobsInserterPerformance,
  style: 'upstream',
};
