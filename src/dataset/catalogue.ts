import type { DatasetId } from './index.ts';
import { bobAngs } from './catalogue/bobang.ts';
import { spaceAge } from './catalogue/space-age.ts';
import type { DatasetInput } from './types.ts';

interface DatasetCatalogueEntry {
  label: string;
  load(): Promise<DatasetInput>;
}

/** Keep this module free of dataset assets so the chooser can render before they load. */
export const datasetCatalogue = {
  'bobang-r4q': {
    label: "Bob's and Angel's",
    load: async () => bobAngs(),
  },
  'space-age-2.1.19': {
    label: 'Space Age',
    load: async () => spaceAge(),
  },
} satisfies Record<DatasetId, DatasetCatalogueEntry>;

export const legacyDatasetId = 'bobang-r4q';

export function isDatasetId(id: string): id is keyof typeof datasetCatalogue {
  return Object.hasOwn(datasetCatalogue, id);
}
