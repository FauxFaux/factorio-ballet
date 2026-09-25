import type { StaticData } from '../types.ts';
import type { DatasetId } from './index.ts';

interface DatasetCatalogueEntry {
  label: string;
  load(): Promise<StaticData>;
}

/** Keep this module free of dataset assets so the chooser can render before they load. */
export const datasetCatalogue = {
  'bobang-r4q': {
    label: "Bob's and Angel's",
    load: async () => (await import('../data/decode.ts')).staticData,
  },
} satisfies Record<DatasetId, DatasetCatalogueEntry>;

export const legacyDatasetId = 'bobang-r4q';

export function isDatasetId(id: string): id is keyof typeof datasetCatalogue {
  return Object.hasOwn(datasetCatalogue, id);
}
