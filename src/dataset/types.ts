import type { StaticData } from '../types.ts';
import type { IconMap } from '../data/icon-map.ts';
import type { InserterPerformance } from '../data/inserter-performance.ts';

export interface DatasetInput {
  staticData: StaticData;
  iconMap: IconMap;
  /** Defaults to the upstream profile for datasets without custom inserter mechanics. */
  inserterPerformance?: InserterPerformance;
}
